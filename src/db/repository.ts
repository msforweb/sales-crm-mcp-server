import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "./database.js";
import type {
  AuditEvent,
  FollowupTask,
  Lead,
  LeadDetails,
  LeadNote,
  LeadStatus,
  NewLead,
  NewTask,
  Page,
  PipelineSummary,
  TaskStatus,
  TaskWithLead,
} from "../crm/types.js";

interface LeadRow {
  id: string; name: string; company: string; email: string; status: LeadStatus;
  source: string; created_at: string; updated_at: string;
}
interface NoteRow { id: string; lead_id: string; body: string; created_at: string }
interface TaskRow {
  id: string; lead_id: string; title: string; due_at: string; status: TaskStatus;
  created_at: string; updated_at: string;
}

const toLead = (row: LeadRow): Lead => ({
  id: row.id, name: row.name, company: row.company, email: row.email, status: row.status,
  source: row.source, createdAt: row.created_at, updatedAt: row.updated_at,
});
const toNote = (row: NoteRow): LeadNote => ({
  id: row.id, leadId: row.lead_id, body: row.body, createdAt: row.created_at,
});
const toTask = (row: TaskRow): FollowupTask => ({
  id: row.id, leadId: row.lead_id, title: row.title, dueAt: row.due_at, status: row.status,
  createdAt: row.created_at, updatedAt: row.updated_at,
});

export interface SearchOptions { query?: string | undefined; status?: LeadStatus | undefined; limit: number; offset: number }
export interface TaskListOptions { leadId?: string | undefined; status?: TaskStatus | undefined; overdueOnly: boolean; limit: number; offset: number }
export interface SeedRecord {
  leads: Array<Lead & { ownerId?: string }>;
  notes: Array<LeadNote & { ownerId?: string }>;
  tasks: Array<FollowupTask & { ownerId?: string }>;
}

export class CrmRepository {
  constructor(private readonly db: SqliteDatabase) {}

  private recordAudit(ownerId: string, operation: string, entityType: AuditEvent["entityType"], entityId: string, changes: Record<string, unknown>, timestamp: string): void {
    this.db.prepare(`INSERT INTO audit_events (id, owner_id, operation, entity_type, entity_id, timestamp, changes_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), ownerId, operation, entityType, entityId, timestamp, JSON.stringify(changes));
  }

  private leadExists(ownerId: string, leadId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM leads WHERE owner_id = ? AND id = ?").get(ownerId, leadId));
  }

  searchLeads(ownerId: string, options: SearchOptions): Page<Lead> {
    const clauses = ["owner_id = @ownerId"];
    const params: Record<string, string | number> = { ownerId, limit: options.limit, offset: options.offset };
    if (options.status) { clauses.push("status = @status"); params.status = options.status; }
    if (options.query?.trim()) {
      clauses.push("(name LIKE @query ESCAPE '\\' OR company LIKE @query ESCAPE '\\' OR email LIKE @query ESCAPE '\\')");
      const escaped = options.query.trim().replace(/[\\%_]/g, "\\$&");
      params.query = `%${escaped}%`;
    }
    const where = clauses.join(" AND ");
    const total = (this.db.prepare(`SELECT COUNT(*) AS count FROM leads WHERE ${where}`).get(params) as { count: number }).count;
    const rows = this.db.prepare(`SELECT id, name, company, email, status, source, created_at, updated_at
      FROM leads WHERE ${where} ORDER BY created_at DESC, id ASC LIMIT @limit OFFSET @offset`).all(params) as LeadRow[];
    return { items: rows.map(toLead), pagination: { total, limit: options.limit, offset: options.offset, hasMore: options.offset + rows.length < total } };
  }

  getLead(ownerId: string, leadId: string): LeadDetails | undefined {
    const row = this.db.prepare(`SELECT id, name, company, email, status, source, created_at, updated_at
      FROM leads WHERE owner_id = ? AND id = ?`).get(ownerId, leadId) as LeadRow | undefined;
    if (!row) return undefined;
    const notes = this.db.prepare(`SELECT id, lead_id, body, created_at FROM notes
      WHERE owner_id = ? AND lead_id = ? ORDER BY created_at ASC, id ASC`).all(ownerId, leadId) as NoteRow[];
    const tasks = this.db.prepare(`SELECT id, lead_id, title, due_at, status, created_at, updated_at FROM tasks
      WHERE owner_id = ? AND lead_id = ? ORDER BY julianday(due_at) ASC, id ASC`).all(ownerId, leadId) as TaskRow[];
    return { ...toLead(row), notes: notes.map(toNote), tasks: tasks.map(toTask) };
  }

  createLead(ownerId: string, input: NewLead, now: string): Lead {
    const lead: Lead = { id: randomUUID(), ...input, status: input.status ?? "new", createdAt: now, updatedAt: now };
    const transaction = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO leads (id, owner_id, name, company, email, status, source, created_at, updated_at)
        VALUES (@id, @ownerId, @name, @company, @email, @status, @source, @createdAt, @updatedAt)`)
        .run({ ...lead, ownerId, createdAt: lead.createdAt, updatedAt: lead.updatedAt });
      this.recordAudit(ownerId, "lead.created", "lead", lead.id, { status: lead.status }, now);
    });
    transaction();
    return lead;
  }

  updateLeadStatus(ownerId: string, leadId: string, status: LeadStatus, now: string): Lead | undefined {
    const transaction = this.db.transaction(() => {
      const previous = this.db.prepare("SELECT status FROM leads WHERE owner_id = ? AND id = ?").get(ownerId, leadId) as { status: LeadStatus } | undefined;
      if (!previous) return undefined;
      this.db.prepare("UPDATE leads SET status = ?, updated_at = ? WHERE owner_id = ? AND id = ?").run(status, now, ownerId, leadId);
      this.recordAudit(ownerId, "lead.status_updated", "lead", leadId, { from: previous.status, to: status }, now);
    });
    transaction();
    const row = this.db.prepare(`SELECT id, name, company, email, status, source, created_at, updated_at FROM leads
      WHERE owner_id = ? AND id = ?`).get(ownerId, leadId) as LeadRow | undefined;
    return row ? toLead(row) : undefined;
  }

  addLeadNote(ownerId: string, leadId: string, body: string, now: string): LeadNote | undefined {
    if (!this.leadExists(ownerId, leadId)) return undefined;
    const note: LeadNote = { id: randomUUID(), leadId, body, createdAt: now };
    const transaction = this.db.transaction(() => {
      this.db.prepare("INSERT INTO notes (id, owner_id, lead_id, body, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(note.id, ownerId, leadId, body, now);
      this.recordAudit(ownerId, "note.created", "note", note.id, { leadId, bodyLength: body.length }, now);
    });
    transaction();
    return note;
  }

  createFollowupTask(ownerId: string, leadId: string, input: NewTask, now: string): FollowupTask | undefined {
    if (!this.leadExists(ownerId, leadId)) return undefined;
    const task: FollowupTask = { id: randomUUID(), leadId, ...input, status: "pending", createdAt: now, updatedAt: now };
    const transaction = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO tasks (id, owner_id, lead_id, title, due_at, status, created_at, updated_at)
        VALUES (@id, @ownerId, @leadId, @title, @dueAt, @status, @createdAt, @updatedAt)`)
        .run({ ...task, ownerId, dueAt: task.dueAt, createdAt: task.createdAt, updatedAt: task.updatedAt });
      this.recordAudit(ownerId, "task.created", "task", task.id, { leadId, dueAt: task.dueAt }, now);
    });
    transaction();
    return task;
  }

  listTasks(ownerId: string, options: TaskListOptions, now: string): Page<TaskWithLead> {
    const clauses = ["t.owner_id = @ownerId"];
    const params: Record<string, string | number> = { ownerId, limit: options.limit, offset: options.offset };
    if (options.leadId) { clauses.push("t.lead_id = @leadId"); params.leadId = options.leadId; }
    if (options.status) { clauses.push("t.status = @status"); params.status = options.status; }
    if (options.overdueOnly) { clauses.push("t.status = 'pending' AND julianday(t.due_at) < julianday(@now)"); params.now = now; }
    const where = clauses.join(" AND ");
    const total = (this.db.prepare(`SELECT COUNT(*) AS count FROM tasks t WHERE ${where}`).get(params) as { count: number }).count;
    const rows = this.db.prepare(`SELECT t.id, t.lead_id, t.title, t.due_at, t.status, t.created_at, t.updated_at, l.name AS lead_name, l.company
      FROM tasks t JOIN leads l ON l.id = t.lead_id AND l.owner_id = t.owner_id
      WHERE ${where} ORDER BY julianday(t.due_at) ASC, t.id ASC LIMIT @limit OFFSET @offset`).all(params) as Array<TaskRow & { lead_name: string; company: string }>;
    return {
      items: rows.map((row) => ({ ...toTask(row), leadName: row.lead_name, company: row.company })),
      pagination: { total, limit: options.limit, offset: options.offset, hasMore: options.offset + rows.length < total },
    };
  }

  completeTask(ownerId: string, taskId: string, now: string): FollowupTask | undefined {
    const transaction = this.db.transaction(() => {
      const row = this.db.prepare(`SELECT id, lead_id, title, due_at, status, created_at, updated_at FROM tasks
        WHERE owner_id = ? AND id = ?`).get(ownerId, taskId) as TaskRow | undefined;
      if (!row) return undefined;
      if (row.status === "completed") return toTask(row);
      this.db.prepare("UPDATE tasks SET status = 'completed', updated_at = ? WHERE owner_id = ? AND id = ?").run(now, ownerId, taskId);
      this.recordAudit(ownerId, "task.completed", "task", taskId, { from: "pending", to: "completed" }, now);
      return { ...toTask(row), status: "completed" as const, updatedAt: now };
    });
    return transaction();
  }

  getPipelineSummary(ownerId: string, now: string): PipelineSummary {
    const statuses = this.db.prepare("SELECT status, COUNT(*) AS count FROM leads WHERE owner_id = ? GROUP BY status").all(ownerId) as Array<{ status: LeadStatus; count: number }>;
    const leadsByStatus: Record<LeadStatus, number> = { new: 0, contacted: 0, qualified: 0, proposal: 0, won: 0, lost: 0 };
    for (const item of statuses) leadsByStatus[item.status] = item.count;
    const tasks = this.db.prepare(`SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'pending' AND julianday(due_at) < julianday(?) THEN 1 ELSE 0 END) AS overdue
      FROM tasks WHERE owner_id = ?`).get(now, ownerId) as { pending: number | null; overdue: number | null };
    return {
      totalLeads: Object.values(leadsByStatus).reduce((sum, count) => sum + count, 0),
      leadsByStatus,
      pendingTasks: tasks.pending ?? 0,
      overdueTasks: tasks.overdue ?? 0,
    };
  }

  listAuditEvents(ownerId: string, limit = 100): AuditEvent[] {
    const rows = this.db.prepare(`SELECT id, operation, entity_type, entity_id, timestamp, changes_json
      FROM audit_events WHERE owner_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?`).all(ownerId, limit) as Array<{
      id: string; operation: string; entity_type: AuditEvent["entityType"]; entity_id: string; timestamp: string; changes_json: string;
    }>;
    return rows.map((row) => ({
      id: row.id, operation: row.operation, entityType: row.entity_type, entityId: row.entity_id,
      timestamp: row.timestamp, changes: JSON.parse(row.changes_json) as Record<string, unknown>,
    }));
  }

  seedDemo(ownerId: string, records: SeedRecord): boolean {
    const transaction = this.db.transaction(() => {
      const exists = this.db.prepare("SELECT 1 FROM leads WHERE owner_id = ? LIMIT 1").get(ownerId);
      if (exists) return false;
      for (const lead of records.leads) {
        this.db.prepare(`INSERT INTO leads (id, owner_id, name, company, email, status, source, created_at, updated_at)
          VALUES (@id, @ownerId, @name, @company, @email, @status, @source, @createdAt, @updatedAt)`)
          .run({ ...lead, ownerId, createdAt: lead.createdAt, updatedAt: lead.updatedAt });
        this.recordAudit(ownerId, "lead.seeded", "lead", lead.id, { status: lead.status }, lead.createdAt);
      }
      for (const note of records.notes) {
        this.db.prepare("INSERT INTO notes (id, owner_id, lead_id, body, created_at) VALUES (?, ?, ?, ?, ?)")
          .run(note.id, ownerId, note.leadId, note.body, note.createdAt);
        this.recordAudit(ownerId, "note.seeded", "note", note.id, { leadId: note.leadId }, note.createdAt);
      }
      for (const task of records.tasks) {
        this.db.prepare(`INSERT INTO tasks (id, owner_id, lead_id, title, due_at, status, created_at, updated_at)
          VALUES (@id, @ownerId, @leadId, @title, @dueAt, @status, @createdAt, @updatedAt)`)
          .run({ ...task, ownerId, dueAt: task.dueAt, createdAt: task.createdAt, updatedAt: task.updatedAt });
        this.recordAudit(ownerId, "task.seeded", "task", task.id, { leadId: task.leadId, status: task.status }, task.createdAt);
      }
      return true;
    });
    return transaction();
  }
}
