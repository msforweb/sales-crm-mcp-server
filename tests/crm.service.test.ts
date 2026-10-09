import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/database.js";
import { CrmRepository } from "../src/db/repository.js";
import { createDemoSeed } from "../src/db/seed-demo.js";
import { CrmError, CrmService } from "../src/crm/service.js";

const tempDirs: string[] = [];
function makeFileDatabase() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "sales-crm-test-"));
  tempDirs.push(directory);
  const databasePath = path.join(directory, "crm.sqlite");
  const db = openDatabase(databasePath);
  return { db, databasePath, repository: new CrmRepository(db) };
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("CRM persistence and ownership", () => {
  it("compares offset timestamps chronologically, including existing stored tasks", () => {
    const { db, repository } = makeFileDatabase();
    const service = new CrmService(repository, () => new Date("2026-10-09T12:00:00.000Z"));
    const lead = service.createLead("owner", { name: "Test", company: "Test", email: "test@example.test", source: "Test" });
    const task = service.createFollowupTask("owner", lead.id, { title: "Overdue", dueAt: "2026-10-09T16:30:00+05:30" });
    expect(task.dueAt).toBe("2026-10-09T11:00:00.000Z");
    db.prepare("UPDATE tasks SET due_at = ? WHERE id = ?").run("2026-10-09T16:30:00+05:30", task.id);
    repository.createFollowupTask("owner", lead.id, { title: "Future", dueAt: "2026-10-09T08:30:00-04:00" }, "2026-10-09T12:00:00.000Z");
    expect(service.listFollowupTasks("owner", { overdueOnly: true }).items.map((item) => item.id)).toEqual([task.id]);
    expect(service.listFollowupTasks("owner", {}).items.map((item) => item.title)).toEqual(["Overdue", "Future"]);
    expect(service.getPipelineSummary("owner").overdueTasks).toBe(1);
    db.close();
  });
  it("seeds 15 synthetic leads once and persists them after reopening", () => {
    const { db, databasePath, repository } = makeFileDatabase();
    expect(repository.seedDemo("synthetic-demo", createDemoSeed(new Date("2026-10-07T12:00:00.000Z")))).toBe(true);
    expect(repository.seedDemo("synthetic-demo", createDemoSeed(new Date("2026-10-08T12:00:00.000Z")))).toBe(false);
    db.close();

    const reopened = openDatabase(databasePath);
    const service = new CrmService(new CrmRepository(reopened), () => new Date("2026-10-07T12:00:00.000Z"));
    expect(service.searchLeads("synthetic-demo", {}).pagination.total).toBe(15);
    const realEstateLead = service.getLead("synthetic-demo", "demo-lead-01");
    expect(realEstateLead.status).toBe("qualified");
    expect(realEstateLead.notes).toHaveLength(1);
    expect(realEstateLead.tasks[0]?.status).toBe("pending");
    reopened.close();
  });

  it("applies search filters and deterministic pagination", () => {
    const { db, repository } = makeFileDatabase();
    repository.seedDemo("synthetic-demo", createDemoSeed());
    const service = new CrmService(repository);
    const page = service.searchLeads("synthetic-demo", { query: "residential", status: "qualified", limit: 1, offset: 0 });
    expect(page.items.map((lead) => lead.name)).toEqual(["Avery Thompson"]);
    expect(page.pagination).toEqual({ total: 1, limit: 1, offset: 0, hasMore: false });
    const firstPage = service.searchLeads("synthetic-demo", { limit: 3 });
    const secondPage = service.searchLeads("synthetic-demo", { limit: 3, offset: 3 });
    expect(firstPage.items.map((lead) => lead.id)).not.toEqual(secondPage.items.map((lead) => lead.id));
    db.close();
  });

  it("validates mutations, scopes records to an owner, and records atomic audit events", () => {
    const { db, repository } = makeFileDatabase();
    repository.seedDemo("synthetic-demo", createDemoSeed());
    const service = new CrmService(repository, () => new Date("2026-10-07T12:00:00.000Z"));
    expect(() => service.getLead("another-user", "demo-lead-01")).toThrow(CrmError);
    expect(() => service.createLead("synthetic-demo", { name: "No email", company: "Test", email: "bad", source: "Test" })).toThrow(/valid email/i);
    expect(() => service.addLeadNote("synthetic-demo", "demo-lead-01", " ")).toThrow(/Note body/i);
    expect(() => service.createFollowupTask("synthetic-demo", "demo-lead-01", { title: "Call", dueAt: "2026-10-08T10:00:00" })).toThrow(/ISO 8601/i);

    service.addLeadNote("synthetic-demo", "demo-lead-01", "Discussed a synthetic listing timeline.");
    service.createFollowupTask("synthetic-demo", "demo-lead-01", { title: "Schedule a synthetic consultation", dueAt: "2026-10-09T12:00:00Z" });
    service.updateLeadStatus("synthetic-demo", "demo-lead-01", "proposal");
    const events = repository.listAuditEvents("synthetic-demo");
    expect(events.some((event) => event.operation === "note.created")).toBe(true);
    expect(events.some((event) => event.operation === "task.created")).toBe(true);
    expect(events.some((event) => event.operation === "lead.status_updated" && event.changes.to === "proposal")).toBe(true);
    expect(repository.listAuditEvents("another-user")).toHaveLength(0);
    db.close();
  });

  it("filters overdue tasks and makes task completion safely repeatable", () => {
    const { db, repository } = makeFileDatabase();
    repository.seedDemo("synthetic-demo", createDemoSeed(new Date("2026-10-07T12:00:00.000Z")));
    const service = new CrmService(repository, () => new Date("2026-10-07T12:00:00.000Z"));
    const overdue = service.listFollowupTasks("synthetic-demo", { overdueOnly: true });
    expect(overdue.items).toHaveLength(2);
    const taskId = overdue.items[0]!.id;
    expect(service.completeFollowupTask("synthetic-demo", taskId).status).toBe("completed");
    expect(service.completeFollowupTask("synthetic-demo", taskId).status).toBe("completed");
    expect(() => service.completeFollowupTask("another-user", taskId)).toThrow(/not found/i);
    expect(repository.listAuditEvents("synthetic-demo").filter((event) => event.operation === "task.completed")).toHaveLength(1);
    db.close();
  });
});
