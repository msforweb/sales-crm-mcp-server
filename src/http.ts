import express, { type Request, type Response } from "express";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { loadConfig, type AppConfig } from "./config.js";
import { AuthenticationError, AuthorizationError, createTokenVerifier, type AuthPrincipal } from "./auth/jwt.js";
import { openDatabase } from "./db/database.js";
import { CrmRepository } from "./db/repository.js";
import { CrmService } from "./crm/service.js";
import { createCrmMcpServer, isCrmWriteTool } from "./mcp/server.js";
import { addOpenAiToolSecuritySchemes } from "./mcp/openai-metadata.js";

const DEMO_OWNER: AuthPrincipal = { subject: "synthetic-demo", scopes: [] };
const TOKEN_RE = /^[\t ]*Bearer[\t ]+([^\s]+)[\t ]*$/i;

function normalizedHost(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try { return new URL(`http://${value}`).hostname.toLowerCase().replace(/^\[|\]$/g, ""); }
  catch { return undefined; }
}

function isLoopback(host: string): boolean {
  const normalized = normalizedHost(host) ?? host.toLowerCase();
  return normalized === "localhost" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1" ||
    (isIP(normalized) === 4 && normalized.startsWith("127."));
}

function requiredScopeForRequest(body: unknown, config: AppConfig): string | undefined {
  if (!config.auth || !body || typeof body !== "object") return undefined;
  const request = body as { method?: unknown; params?: { name?: unknown } };
  if (request.method === "tools/call" && typeof request.params?.name === "string" && isCrmWriteTool(request.params.name)) return config.auth.writeScope;
  if (request.method === "tools/call" || request.method === "resources/read" || request.method === "prompts/get") return config.auth.readScope;
  return undefined;
}

function authInfo(token: string, scopes: string[], expiresAt: number | undefined, resource: string) {
  const auth = {
    token,
    clientId: "mcp-client",
    scopes,
    ...(expiresAt ? { expiresAt } : {}),
    resource: new URL(resource),
  };
  return auth;
}

export function createHttpApplication(config: AppConfig) {
  if (!isLoopback(config.host) && config.mode !== "authenticated") {
    throw new Error("A non-loopback HTTP bind requires authenticated mode.");
  }
  if (config.mode === "authenticated" && !config.auth) throw new Error("Authenticated mode requires OAuth configuration.");

  const db = openDatabase(config.databasePath);
  const service = new CrmService(new CrmRepository(db));
  const verifyToken = config.auth ? createTokenVerifier(config.auth) : undefined;
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb", strict: true }));

  app.use((req, res, next) => {
    const host = normalizedHost(req.get("host"));
    const allowedHosts = config.allowedHosts.map((item) => normalizedHost(item));
    if (!host || !allowedHosts.includes(host)) {
      res.status(403).json({ error: "Host is not allowed." });
      return;
    }

    const origin = req.get("origin");
    if (origin) {
      let normalizedOrigin: string;
      try { normalizedOrigin = new URL(origin).origin; }
      catch {
        res.status(403).json({ error: "Origin is not allowed." });
        return;
      }
      const allowedOrigins = config.allowedOrigins.map((item) => {
        try { return new URL(item).origin; } catch { return ""; }
      });
      if (!allowedOrigins.includes(normalizedOrigin)) {
        res.status(403).json({ error: "Origin is not allowed." });
        return;
      }
      res.setHeader("Access-Control-Allow-Origin", normalizedOrigin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Expose-Headers", "MCP-Session-Id, MCP-Protocol-Version, WWW-Authenticate");
    }
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });

  app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

  if (config.mode === "demo") {
    app.get("/", (_req, res) => res.sendFile(path.resolve("dist/ui/demo-host.html")));
    app.get("/demo-host.js", (_req, res) => res.sendFile(path.resolve("dist/ui/demo-host.js")));
  }

  if (config.auth) {
    const metadata = {
      resource: config.auth.resource,
      authorization_servers: [config.auth.authorizationServer],
      scopes_supported: [config.auth.readScope, config.auth.writeScope],
      bearer_methods_supported: ["header"],
    };
    app.get("/.well-known/oauth-protected-resource", (_req, res) => res.json(metadata));
    app.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => res.json(metadata));
  }

  app.all("/mcp", async (req: Request, res: Response) => {
    let principal: AuthPrincipal | undefined;
    let verifiedAuth;
    if (config.mode === "demo") {
      principal = DEMO_OWNER;
    } else {
      const authorization = req.get("authorization");
      const bearer = authorization?.match(TOKEN_RE)?.[1];
      const requiredScope = requiredScopeForRequest(req.body, config);
      const metadataUri = `${config.auth!.resource.replace(/\/$/, "")}/.well-known/oauth-protected-resource`;
      if (!bearer && requiredScope) {
        res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${metadataUri}", scope="${requiredScope}"`);
        res.status(401).json({ error: "Authentication required." });
        return;
      }
      if (authorization && !bearer) {
        res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${metadataUri}", error="invalid_token"`);
        res.status(401).json({ error: "Invalid bearer token." });
        return;
      }
      if (bearer) {
        try {
          verifiedAuth = await verifyToken!(bearer);
          principal = verifiedAuth.principal;
        } catch (error) {
          if (!(error instanceof AuthenticationError)) console.error("Bearer token verification failed.");
          res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${metadataUri}", error="invalid_token"`);
          res.status(401).json({ error: "Invalid or expired access token." });
          return;
        }
        if (requiredScope && !principal.scopes.includes(requiredScope)) {
          res.setHeader("WWW-Authenticate", `Bearer error="insufficient_scope", scope="${requiredScope}", resource_metadata="${metadataUri}", error_description="The requested CRM permission is required."`);
          res.status(403).json({ error: "Insufficient scope." });
          return;
        }
      }
    }

    const server = createCrmMcpServer(service, config, principal);
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const mcpTransport = addOpenAiToolSecuritySchemes(transport, config);
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await transport.close();
      await server.close();
    };
    res.once("close", () => { void close(); });
    try {
      await server.connect(mcpTransport);
      if (verifiedAuth && config.auth) {
        (req as Request & { auth?: AuthInfo }).auth = authInfo(req.get("authorization")!.match(TOKEN_RE)![1]!, verifiedAuth.principal.scopes,
          typeof verifiedAuth.payload.exp === "number" ? verifiedAuth.payload.exp : undefined, config.auth.resource);
      }
        await transport.handleRequest(req as Request & { auth?: AuthInfo }, res, req.body);
    } catch {
      console.error("MCP HTTP request failed.");
      if (!res.headersSent) res.status(500).json({ error: "MCP request failed." });
      await close();
    }
  });

  app.use((_req, res) => res.status(404).json({ error: "Not found." }));
  return { app, close: () => { db.close(); } };
}

export async function startHttpServer(config = loadConfig()): Promise<() => Promise<void>> {
  const { app, close } = createHttpApplication(config);
  const listener = app.listen(config.port, config.host, () => {
    console.error(`Sales CRM MCP server listening at http://${config.host}:${config.port}/mcp`);
  });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    close();
  };
  process.once("SIGINT", () => { void stop().then(() => process.exit(0)); });
  process.once("SIGTERM", () => { void stop().then(() => process.exit(0)); });
  return stop;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startHttpServer();
}
