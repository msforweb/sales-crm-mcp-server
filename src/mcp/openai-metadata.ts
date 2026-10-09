import type { JSONRPCMessage } from "@modelcontextprotocol/server";
import type { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { AppConfig } from "../config.js";
import { isCrmWriteTool } from "./server.js";

type OpenAiToolDefinition = { name?: string; securitySchemes?: Array<{ type: "noauth" } | { type: "oauth2"; scopes: string[] }> };
type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function addOpenAiToolSecuritySchemes(
  transport: NodeStreamableHTTPServerTransport,
  config: AppConfig,
): NodeStreamableHTTPServerTransport {
  const securityFor = (name: string): OpenAiToolDefinition["securitySchemes"] => {
    if (config.mode === "demo") return [{ type: "noauth" }];
    const scope = isCrmWriteTool(name) ? config.auth!.writeScope : config.auth!.readScope;
    return [{ type: "oauth2", scopes: [scope] }];
  };

  const originalSend = transport.send.bind(transport);
  transport.send = async (message: JSONRPCMessage, options?: Parameters<typeof transport.send>[1]) => {
    const wireMessage = message as unknown as JsonRecord;
    const result = wireMessage["result"];
    if (isRecord(result) && Array.isArray(result["tools"])) {
      const tools = result["tools"].map((candidate) => {
        if (!isRecord(candidate) || typeof candidate["name"] !== "string") return candidate;
        return { ...candidate, securitySchemes: securityFor(candidate["name"]) };
      });
      const outgoing = { ...wireMessage, result: { ...result, tools } } as unknown as JSONRPCMessage;
      await originalSend(outgoing, options);
      return;
    }
    await originalSend(message, options);
  };
  return transport;
}
