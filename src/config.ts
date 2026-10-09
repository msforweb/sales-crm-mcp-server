import "dotenv/config";
import path from "node:path";
import { z } from "zod";

const csv = (value: string | undefined, fallback: string[]) =>
  value === undefined ? fallback : value.split(",").map((item) => item.trim()).filter(Boolean);

export interface AppConfig {
  mode: "demo" | "authenticated";
  databasePath: string;
  host: string;
  port: number;
  allowedHosts: string[];
  allowedOrigins: string[];
  demoEnabled: boolean;
  auth?: {
    issuer: string;
    audience: string;
    jwksUrl: string;
    resource: string;
    authorizationServer: string;
    readScope: string;
    writeScope: string;
  };
}

const envSchema = z.object({
  CRM_MODE: z.enum(["demo", "authenticated"]),
  DEMO_MODE: z.string().optional(),
  CRM_DATABASE_PATH: z.string().default("./data/sales-crm.sqlite"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  ALLOWED_HOSTS: z.string().optional(),
  ALLOWED_ORIGINS: z.string().optional(),
  OAUTH_ISSUER: z.string().url().optional(),
  OAUTH_AUDIENCE: z.string().min(1).optional(),
  OAUTH_JWKS_URL: z.string().url().optional(),
  OAUTH_RESOURCE: z.string().url().optional(),
  OAUTH_AUTHORIZATION_SERVER: z.string().url().optional(),
  AUTH_READ_SCOPE: z.string().min(1).default("crm:read"),
  AUTH_WRITE_SCOPE: z.string().min(1).default("crm:write"),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid configuration: ${details}`);
  }

  const value = parsed.data;
  const demoEnabled = value.DEMO_MODE === "true";
  if (value.CRM_MODE === "demo" && !demoEnabled) {
    throw new Error("Demo mode requires DEMO_MODE=true. Synthetic data is never enabled implicitly.");
  }
  if (value.CRM_MODE === "authenticated" && demoEnabled) {
    throw new Error("DEMO_MODE must not be true in authenticated mode.");
  }

  const authValues = [value.OAUTH_ISSUER, value.OAUTH_AUDIENCE, value.OAUTH_JWKS_URL, value.OAUTH_RESOURCE, value.OAUTH_AUTHORIZATION_SERVER];
  let auth: AppConfig["auth"];
  if (value.CRM_MODE === "authenticated") {
    if (authValues.some((item) => item === undefined)) {
      throw new Error("Authenticated mode requires OAUTH_ISSUER, OAUTH_AUDIENCE, OAUTH_JWKS_URL, OAUTH_RESOURCE, and OAUTH_AUTHORIZATION_SERVER.");
    }
    auth = {
      issuer: value.OAUTH_ISSUER!,
      audience: value.OAUTH_AUDIENCE!,
      jwksUrl: value.OAUTH_JWKS_URL!,
      resource: value.OAUTH_RESOURCE!,
      authorizationServer: value.OAUTH_AUTHORIZATION_SERVER!,
      readScope: value.AUTH_READ_SCOPE,
      writeScope: value.AUTH_WRITE_SCOPE,
    };
  }

  return {
    mode: value.CRM_MODE,
    databasePath: path.resolve(value.CRM_DATABASE_PATH),
    host: value.HOST,
    port: value.PORT,
    allowedHosts: csv(value.ALLOWED_HOSTS, ["localhost", "127.0.0.1"]),
    allowedOrigins: csv(value.ALLOWED_ORIGINS, [`http://localhost:${value.PORT}`, `http://127.0.0.1:${value.PORT}`]),
    demoEnabled,
    ...(auth ? { auth } : {}),
  };
}