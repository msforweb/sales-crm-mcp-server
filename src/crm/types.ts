export const LEAD_STATUSES = ["new", "contacted", "qualified", "proposal", "won", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const TASK_STATUSES = ["pending", "completed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Lead {
  id: string;
  name: string;
  company: string;
  email: string;
  status: LeadStatus;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeadNote {
  id: string;
  leadId: string;
  body: string;
  createdAt: string;
}

export interface FollowupTask {
  id: string;
  leadId: string;
  title: string;
  dueAt: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LeadDetails extends Lead {
  notes: LeadNote[];
  tasks: FollowupTask[];
}

export interface TaskWithLead extends FollowupTask {
  leadName: string;
  company: string;
}

export interface Page<T> {
  items: T[];
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
}

export interface PipelineSummary {
  totalLeads: number;
  leadsByStatus: Record<LeadStatus, number>;
  pendingTasks: number;
  overdueTasks: number;
}

export interface AuditEvent {
  id: string;
  operation: string;
  entityType: "lead" | "note" | "task";
  entityId: string;
  timestamp: string;
  changes: Record<string, unknown>;
}

export interface NewLead {
  name: string;
  company: string;
  email: string;
  source: string;
  status?: LeadStatus;
}

export interface NewTask {
  title: string;
  dueAt: string;
}