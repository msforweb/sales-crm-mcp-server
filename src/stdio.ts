import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/database.js";
import { CrmRepository } from "./db/repository.js";
import { CrmService } from "./crm/service.js";
import { createCrmMcpServer } from "./mcp/server.js";

const config = loadConfig();
if (config.mode !== "demo" || !config.demoEnabled) {
  throw new Error("The stdio entry point serves only explicitly enabled synthetic demo data.");
}

const db = openDatabase(config.databasePath);
const repository = new CrmRepository(db);
const service = new CrmService(repository);
const handle = serveStdio(() => createCrmMcpServer(service, config), {
  onerror: () => console.error("MCP stdio transport error."),
});

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  try { await handle.close(); } finally { db.close(); }
};
process.once("SIGINT", () => { void close(); });
process.once("SIGTERM", () => { void close(); });
process.stdin.once("end", () => { void close(); });