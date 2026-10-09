import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { Script } from "node:vm";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import { createHttpApplication } from "../src/http.js";
import { openDatabase } from "../src/db/database.js";
import { CrmRepository } from "../src/db/repository.js";
import { createDemoSeed } from "../src/db/seed-demo.js";

interface RunningApp {
  listener: Server;
  close: () => void;
  url: string;
}

const runningApps: Array<() => Promise<void>> = [];
const temporaryDirectories: string[] = [];

async function startApp(config: AppConfig): Promise<RunningApp> {
  const application = createHttpApplication(config);
  const listener = createServer(application.app);
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("Could not bind ephemeral HTTP port.");
  const url = `http://127.0.0.1:${address.port}/mcp`;
  runningApps.push(async () => {
    await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    application.close();
  });
  return { listener, close: application.close, url };
}

function databasePath(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "crm-http-test-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "crm.sqlite");
}

function demoConfig(dbPath: string): AppConfig {
  return {
    mode: "demo", databasePath: dbPath, host: "127.0.0.1", port: 3000,
    allowedHosts: ["127.0.0.1", "localhost"], allowedOrigins: ["http://127.0.0.1", "http://localhost:3000"], demoEnabled: true,
  };
}

async function connect(url: string, token?: string, fetcher: typeof fetch = fetch) {
  const authProvider = token ? { token: async () => token } : undefined;
  const transport = new StreamableHTTPClientTransport(new URL(url), { fetch: fetcher, ...(authProvider ? { authProvider } : {}) });
  const client = new Client({ name: "crm-http-test", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
}

function findToolDefinitions(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findToolDefinitions(item);
      if (result.length) return result;
    }
    return [];
  }
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record["tools"]) && record["tools"].every((tool) => typeof tool === "object" && tool !== null && "name" in tool)) {
    return record["tools"] as Array<Record<string, unknown>>;
  }
  for (const child of Object.values(record)) {
    const result = findToolDefinitions(child);
    if (result.length) return result;
  }
  return [];
}

afterEach(async () => {
  for (const close of runningApps.splice(0)) await close();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Streamable HTTP MCP integration", () => {
  it("initializes with the official client and exposes tools, resource, and prompt", async () => {
    const config = demoConfig(databasePath());
    const db = openDatabase(config.databasePath);
    try { new CrmRepository(db).seedDemo("synthetic-demo", createDemoSeed()); } finally { db.close(); }
    const app = await startApp(config);
    let rawToolDefinitions: Array<Record<string, unknown>> = [];
    const captureFetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
      const [input, init] = args;
      const response = await fetch(input, init);
      if (typeof init?.body === "string") {
        try {
          const method = (JSON.parse(init.body) as { method?: string }).method;
          if (method === "tools/list") {
            rawToolDefinitions = findToolDefinitions(await response.clone().json());
          }
        } catch { }
      }
      return response;
    };
    const transport = new StreamableHTTPClientTransport(new URL(app.url), { fetch: captureFetch });
    const client = new Client({ name: "crm-http-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain("search_leads");
      expect(tools.map((tool) => tool.name)).toContain("complete_followup_task");
      const searchTool = tools.find((tool) => tool.name === "search_leads");
      expect(searchTool?._meta).toMatchObject({ ui: { resourceUri: "ui://sales-crm/v1/crm-dashboard.html" } });
      expect(rawToolDefinitions.find((tool) => tool["name"] === "search_leads")?.["securitySchemes"]).toEqual([{ type: "noauth" }]);
      const summary = await client.callTool({ name: "get_pipeline_summary", arguments: {} });
      expect(summary.isError).not.toBe(true);
      const resource = await client.readResource({ uri: "crm://pipeline/summary" });
      expect(resource.contents[0]?.mimeType).toBe("application/json");
      const widget = await client.readResource({ uri: "ui://sales-crm/v1/crm-dashboard.html" });
      expect(widget.contents[0]?.mimeType).toBe("text/html;profile=mcp-app");
      const widgetText = widget.contents[0] && "text" in widget.contents[0] ? widget.contents[0].text : "";
      expect(widgetText).toContain("Sales CRM Lead Desk");
      expect(widgetText).toContain("complete_followup_task");
      expect(widgetText).toContain(".topbar");
      expect(widgetText).not.toContain("<style></style>");
      const inlineScript = widgetText.match(/<script>([\s\S]*?)<\/script>/)?.[1];
      expect(inlineScript).toBeTruthy();
      expect(() => new Script(inlineScript!)).not.toThrow();
      await request(app.listener).get("/").set("Host", "127.0.0.1").expect(200).expect(/Sales CRM demo/);
      await request(app.listener).get("/demo-host.js").set("Host", "127.0.0.1").expect(200);
      const leadResource = await client.readResource({ uri: "crm://leads/demo-lead-01" });
      expect(leadResource.contents[0]?.mimeType).toBe("application/json");
      const prompt = await client.getPrompt({ name: "prepare_lead_followup", arguments: { leadId: "demo-lead-01" } });
      expect(prompt.messages).toHaveLength(2);
      expect(JSON.stringify(prompt.messages)).toContain("untrusted data");
      expect(JSON.stringify(prompt.messages)).toContain("Do not send the email");
      const templates = await client.listResourceTemplates();
      expect(templates.resourceTemplates[0]?.uriTemplate).toBe("crm://leads/{leadId}");
      const completed = await client.callTool({ name: "complete_followup_task", arguments: { taskId: "demo-task-01" } });
      expect(completed.isError).not.toBe(true);
      expect((completed.structuredContent as { status: string }).status).toBe("completed");
    } finally {
      await client.close();
      await transport.close();
    }
  });

  it("rejects disallowed Host and Origin while allowing requests without Origin", async () => {
    const config = demoConfig(databasePath());
    const application = createHttpApplication(config);
    try {
      await request(application.app).get("/health").set("Host", "attacker.invalid").expect(403);
      await request(application.app).get("/health").set("Host", "localhost:3000").set("Origin", "https://attacker.invalid").expect(403);
      await request(application.app).get("/health").set("Host", "localhost:3000").expect(200);
    } finally {
      application.close();
    }
  });

  it("verifies signed tokens, read/write scopes, and owner isolation using Keycloak-shaped JWT claims", async () => {
    const issuer = "https://identity.example.test/realms/sales";
    const audience = "https://crm.example.test";
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "test-signing-key";
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";
    const jwksListener = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [publicJwk] }));
    });
    await new Promise<void>((resolve) => jwksListener.listen(0, "127.0.0.1", resolve));
    const jwksAddress = jwksListener.address();
    if (!jwksAddress || typeof jwksAddress === "string") throw new Error("Could not bind test JWKS server.");

    const config: AppConfig = {
      ...demoConfig(databasePath()),
      mode: "authenticated",
      demoEnabled: false,
      auth: {
        issuer, audience, jwksUrl: `http://127.0.0.1:${jwksAddress.port}/jwks`,
        resource: audience, authorizationServer: issuer, readScope: "crm:read", writeScope: "crm:write",
      },
    };
    const app = await startApp(config);
    const issue = async (subject: string, scope: string, expiry = "10m", tokenIssuer = issuer, tokenAudience: string | string[] = audience) => new SignJWT({ scope, name: `Synthetic ${subject}` })
      .setProtectedHeader({ alg: "RS256", kid: "test-signing-key" })
      .setSubject(subject).setIssuer(tokenIssuer).setAudience(tokenAudience).setIssuedAt().setExpirationTime(expiry).sign(privateKey);

    try {
      const readerToken = await issue("user-alpha", "crm:read");
      let authenticatedToolDefinitions: Array<Record<string, unknown>> = [];
      const captureAuthFetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
        const [input, init] = args;
        const response = await fetch(input, init);
        if (typeof init?.body === "string") {
          try {
            if ((JSON.parse(init.body) as { method?: string }).method === "tools/list") {
              authenticatedToolDefinitions = findToolDefinitions(await response.clone().json());
            }
          } catch { }
        }
        return response;
      };
      const reader = await connect(app.url, readerToken, captureAuthFetch);
      try {
        const { tools } = await reader.client.listTools();
        expect(tools.map((tool) => tool.name)).toContain("get_lead");
        expect(authenticatedToolDefinitions.find((tool) => tool["name"] === "get_lead")?.["securitySchemes"]).toEqual([{ type: "oauth2", scopes: ["crm:read"] }]);
        expect(authenticatedToolDefinitions.find((tool) => tool["name"] === "add_lead_note")?.["securitySchemes"]).toEqual([{ type: "oauth2", scopes: ["crm:write"] }]);
        const summary = await reader.client.callTool({ name: "get_pipeline_summary", arguments: {} });
        expect(summary.isError).not.toBe(true);
        expect(summary.structuredContent).toMatchObject({ totalLeads: 0 });
        await expect(reader.client.callTool({ name: "create_lead", arguments: { name: "A", company: "B", email: "a@example.test", source: "Test" } })).rejects.toThrow();
      } finally {
        await reader.client.close();
        await reader.transport.close();
      }

      const writerToken = await issue("user-beta", "crm:read crm:write");
      const writer = await connect(app.url, writerToken);
      let leadId = "";
      try {
        const created = await writer.client.callTool({ name: "create_lead", arguments: { name: "Beta User", company: "Private Co", email: "beta@example.test", source: "Test" } });
        leadId = (created.structuredContent as { id: string }).id;
      } finally {
        await writer.client.close();
        await writer.transport.close();
      }

      const otherUser = await connect(app.url, await issue("user-gamma", "crm:read crm:write"));
      try {
        const search = await otherUser.client.callTool({ name: "search_leads", arguments: { query: "Private Co" } });
        expect((search.structuredContent as { pagination: { total: number } }).pagination.total).toBe(0);
        const details = await otherUser.client.callTool({ name: "get_lead", arguments: { leadId } });
        expect(details.isError).toBe(true);
      } finally {
        await otherUser.client.close();
        await otherUser.transport.close();
      }

      const protocolHeaders = { Host: "127.0.0.1", Accept: "application/json, text/event-stream" };
      const authChallenge = await request(app.listener).post("/mcp").set(protocolHeaders).send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "no-auth", version: "1" } } });
      expect(authChallenge.status).toBe(200);
      const absentToken = await request(app.listener).post("/mcp").set(protocolHeaders).send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_pipeline_summary", arguments: {} } });
      expect(absentToken.status).toBe(401);
      expect(absentToken.headers["www-authenticate"]).toContain("oauth-protected-resource");
      const protectedResource = await request(app.listener).get("/.well-known/oauth-protected-resource").set("Host", "127.0.0.1").expect(200);
      expect(protectedResource.body).toMatchObject({ resource: audience, authorization_servers: [issuer], scopes_supported: ["crm:read", "crm:write"] });
      const initializeRequest = { jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "invalid-token", version: "1" } } };
      const invalidTokens = [
        "not.a.jwt",
        await issue("expired-user", "crm:read", "-1s"),
        await issue("wrong-issuer", "crm:read", "10m", "https://other-issuer.example.test/realm"),
        await issue("wrong-audience", "crm:read", "10m", issuer, "https://other-resource.example.test"),
      ];
      for (const token of invalidTokens) {
        const response = await request(app.listener).post("/mcp").set(protocolHeaders).set("Authorization", `Bearer ${token}`).send(initializeRequest);
        expect(response.status).toBe(401);
      }
    } finally {
      await new Promise<void>((resolve, reject) => jwksListener.close((error) => error ? reject(error) : resolve()));
    }
  });
});
