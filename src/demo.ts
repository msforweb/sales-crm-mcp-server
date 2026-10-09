import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { openDatabase } from "./db/database.js";
import { CrmRepository } from "./db/repository.js";

const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "sales-crm-demo-"));
const databasePath = path.join(temporaryDirectory, "demo.sqlite");
const env = {
  ...process.env,
  CRM_MODE: "demo",
  DEMO_MODE: "true",
  CRM_DATABASE_PATH: databasePath,
};

function structured<T>(result: { structuredContent?: unknown | undefined; isError?: boolean | undefined; content: unknown[] }): T {
  const content = result.content as Array<{ text?: string | undefined }>;
  assert.notEqual(result.isError, true, content.map((item) => item.text).filter(Boolean).join("\n"));
  if (result.structuredContent !== undefined) return result.structuredContent as T;
  return JSON.parse(content.find((item) => item.text)?.text ?? "null") as T;
}

try {
  const seed = spawnSync(process.execPath, [path.resolve("dist/seed.js")], { env, encoding: "utf8" });
  assert.equal(seed.status, 0, seed.stderr || seed.stdout);

  const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve("dist/stdio.js")], cwd: process.cwd(), env, stderr: "inherit" });
  const client = new Client({ name: "sales-crm-demo-client", version: "1.0.0" });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const expectedTools = ["search_leads", "get_lead", "create_lead", "update_lead_status", "add_lead_note", "create_followup_task", "list_followup_tasks", "complete_followup_task", "get_pipeline_summary"];
    for (const tool of expectedTools) assert.ok(tools.some((candidate) => candidate.name === tool), `Missing tool: ${tool}`);
    const resources = await client.listResources();
    const templates = await client.listResourceTemplates();
    const prompts = await client.listPrompts();
    assert.ok(resources.resources.some((resource) => resource.uri === "crm://pipeline/summary"));
    assert.ok(templates.resourceTemplates.some((template) => template.uriTemplate === "crm://leads/{leadId}"));
    assert.ok(prompts.prompts.some((prompt) => prompt.name === "prepare_lead_followup"));

    const search = structured<{ items: Array<{ id: string; name: string }> }>(await client.callTool({ name: "search_leads", arguments: { query: "Juniper Residential" } }));
    const lead = search.items[0];
    assert.ok(lead, "Expected synthetic real-estate lead in seed data");
    const initial = structured<{ notes: unknown[]; tasks: unknown[] }>(await client.callTool({ name: "get_lead", arguments: { leadId: lead.id } }));
    assert.ok(initial.notes.length > 0 && initial.tasks.length > 0);

    const note = structured<{ id: string }>(await client.callTool({ name: "add_lead_note", arguments: { leadId: lead.id, body: "Demo: reviewed the synthetic portfolio timing and next steps." } }));
    const task = structured<{ id: string }>(await client.callTool({ name: "create_followup_task", arguments: { leadId: lead.id, title: "Demo: share consultation options", dueAt: "2026-10-10T15:00:00Z" } }));
    structured(await client.callTool({ name: "update_lead_status", arguments: { leadId: lead.id, status: "proposal" } }));
    const summary = await client.readResource({ uri: "crm://pipeline/summary" });
    assert.ok(summary.contents.length === 1 && summary.contents[0]?.mimeType === "application/json");
    const prompt = await client.getPrompt({ name: "prepare_lead_followup", arguments: { leadId: lead.id } });
    assert.ok(prompt.messages.length >= 2);
    const refreshed = structured<{ status: string; notes: Array<{ id: string }>; tasks: Array<{ id: string }> }>(await client.callTool({ name: "get_lead", arguments: { leadId: lead.id } }));
    assert.equal(refreshed.status, "proposal");
    assert.ok(refreshed.notes.some((entry) => entry.id === note.id));
    assert.ok(refreshed.tasks.some((entry) => entry.id === task.id));
    console.log("stdio MCP demo passed: discovery, lead workflow, resource, prompt, and persisted mutations verified.");
  } finally {
    await client.close();
    await transport.close();
  }

  const verifyDb = openDatabase(databasePath);
  try {
    const events = new CrmRepository(verifyDb).listAuditEvents("synthetic-demo");
    assert.ok(events.some((event) => event.operation === "note.created"));
    assert.ok(events.some((event) => event.operation === "task.created"));
  } finally {
    verifyDb.close();
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}