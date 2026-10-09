import { z } from "zod";
import { LEAD_STATUSES, TASK_STATUSES, type Lead, type LeadDetails, type LeadStatus, type NewLead, type NewTask, type Page, type PipelineSummary, type TaskStatus, type TaskWithLead, type FollowupTask, type LeadNote } from "./types.js";
import { CrmRepository } from "../db/repository.js";

const emailSchema = z.email();
const leadInputSchema = z.object({
  name: z.string().trim().min(1).max(120), company: z.string().trim().min(1).max(160),
  email: emailSchema, source: z.string().trim().min(1).max(80), status: z.enum(LEAD_STATUSES).optional(),
});
const noteSchema = z.string().trim().min(1).max(4000);
const taskSchema = z.object({ title: z.string().trim().min(1).max(200), dueAt: z.iso.datetime({ offset: true }) });
const searchSchema = z.object({ query: z.string().trim().max(200).optional(), status: z.enum(LEAD_STATUSES).optional(), limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).max(10000).default(0) });
const taskListSchema = z.object({ leadId: z.string().min(1).optional(), status: z.enum(TASK_STATUSES).optional(), overdueOnly: z.boolean().default(false), limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).max(10000).default(0) });

export class CrmError extends Error {
  constructor(message: string, readonly code: "NOT_FOUND" | "VALIDATION") { super(message); }
}

export class CrmService {
  constructor(private readonly repository: CrmRepository, private readonly clock: () => Date = () => new Date()) {}

  private now(): string { return this.clock().toISOString(); }
  private requireLead<T>(value: T | undefined, id: string): T {
    if (value === undefined) throw new CrmError(`Lead '${id}' was not found.`, "NOT_FOUND");
    return value;
  }

  searchLeads(ownerId: string, input: unknown): Page<Lead> {
    const parsed = searchSchema.safeParse(input);
    if (!parsed.success) throw new CrmError("Invalid lead search input.", "VALIDATION");
    return this.repository.searchLeads(ownerId, parsed.data);
  }

  getLead(ownerId: string, leadId: string): LeadDetails {
    return this.requireLead(this.repository.getLead(ownerId, leadId), leadId);
  }

  createLead(ownerId: string, input: unknown): Lead {
    const parsed = leadInputSchema.safeParse(input);
    if (!parsed.success) throw new CrmError("Lead details are invalid. Provide a valid email and all required fields.", "VALIDATION");
    return this.repository.createLead(ownerId, parsed.data as NewLead, this.now());
  }

  updateLeadStatus(ownerId: string, leadId: string, status: LeadStatus): Lead {
    if (!LEAD_STATUSES.includes(status)) throw new CrmError("The requested lead status is invalid.", "VALIDATION");
    return this.requireLead(this.repository.updateLeadStatus(ownerId, leadId, status, this.now()), leadId);
  }

  addLeadNote(ownerId: string, leadId: string, body: unknown): LeadNote {
    const parsed = noteSchema.safeParse(body);
    if (!parsed.success) throw new CrmError("Note body must contain 1 to 4000 characters.", "VALIDATION");
    return this.requireLead(this.repository.addLeadNote(ownerId, leadId, parsed.data, this.now()), leadId);
  }

  createFollowupTask(ownerId: string, leadId: string, input: unknown): FollowupTask {
    const parsed = taskSchema.safeParse(input);
    if (!parsed.success || !Number.isFinite(Date.parse(parsed.data?.dueAt ?? ""))) {
      throw new CrmError("Task requires a nonempty title and a valid ISO 8601 dueAt timestamp with timezone.", "VALIDATION");
    }
    const inputUtc: NewTask = { ...parsed.data, dueAt: new Date(parsed.data.dueAt).toISOString() };
    return this.requireLead(this.repository.createFollowupTask(ownerId, leadId, inputUtc, this.now()), leadId);
  }

  listFollowupTasks(ownerId: string, input: unknown): Page<TaskWithLead> {
    const parsed = taskListSchema.safeParse(input);
    if (!parsed.success) throw new CrmError("Invalid follow-up task filters.", "VALIDATION");
    return this.repository.listTasks(ownerId, parsed.data, this.now());
  }

  completeFollowupTask(ownerId: string, taskId: string): FollowupTask {
    const task = this.repository.completeTask(ownerId, taskId, this.now());
    if (!task) throw new CrmError(`Follow-up task '${taskId}' was not found.`, "NOT_FOUND");
    return task;
  }

  getPipelineSummary(ownerId: string): PipelineSummary {
    return this.repository.getPipelineSummary(ownerId, this.now());
  }

  getLeadForPrompt(ownerId: string, leadId: string): LeadDetails {
    return this.getLead(ownerId, leadId);
  }
}
