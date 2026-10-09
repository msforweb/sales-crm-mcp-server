import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { AppConfig } from "../config.js";

export interface AuthPrincipal {
  subject: string;
  scopes: string[];
  name?: string;
  email?: string;
}

export class AuthenticationError extends Error {
  constructor(message = "A valid bearer access token is required.") { super(message); }
}

export class AuthorizationError extends Error {
  constructor(readonly requiredScopes: string[]) { super("The access token does not grant the required CRM permission."); }
}

export function createTokenVerifier(config: NonNullable<AppConfig["auth"]>) {
  const jwks = createRemoteJWKSet(new URL(config.jwksUrl));

  return async (token: string): Promise<{ principal: AuthPrincipal; payload: JWTPayload }> => {
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: config.issuer,
        audience: config.audience,
        algorithms: ["RS256", "RS384", "RS512", "PS256", "ES256", "ES384", "ES512"],
      });
      if (typeof payload.sub !== "string" || payload.sub.trim().length === 0) throw new AuthenticationError();
      if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) throw new AuthenticationError();
      const scopeClaim = payload.scope;
      const scopes = typeof scopeClaim === "string"
        ? scopeClaim.split(/\s+/).filter(Boolean)
        : Array.isArray(payload.scp) && payload.scp.every((scope) => typeof scope === "string")
          ? payload.scp
          : [];
      const principal: AuthPrincipal = {
        subject: payload.sub,
        scopes,
        ...(typeof payload.name === "string" ? { name: payload.name } : {}),
        ...(typeof payload.email === "string" ? { email: payload.email } : {}),
      };
      return { principal, payload };
    } catch (error) {
      if (error instanceof AuthenticationError) throw error;
      throw new AuthenticationError();
    }
  };
}