import type { SeedRecord } from "./repository.js";
import type { LeadStatus } from "../crm/types.js";

const demoLeads: Array<{ name: string; company: string; status: LeadStatus; source: string }> = [
  { name: "Avery Thompson", company: "Juniper Residential", status: "qualified", source: "Referral" },
  { name: "Maya Chen", company: "Northstar Analytics", status: "contacted", source: "Website" },
  { name: "Ethan Brooks", company: "Cedar Peak Logistics", status: "proposal", source: "Conference" },
  { name: "Sofia Ramirez", company: "Brightpath Education", status: "new", source: "Inbound" },
  { name: "Noah Patel", company: "Harborlight Dental Group", status: "qualified", source: "Referral" },
  { name: "Olivia Martin", company: "Fieldstone Property Partners", status: "contacted", source: "Networking" },
  { name: "Liam Walker", company: "Meridian Solar Works", status: "won", source: "Website" },
  { name: "Isabella Nguyen", company: "Bluebird Pediatric Care", status: "new", source: "Inbound" },
  { name: "Lucas Foster", company: "Redwood Kitchen Supply", status: "proposal", source: "Trade Show" },
  { name: "Amara Okafor", company: "Cobalt Creative Studio", status: "qualified", source: "Referral" },
  { name: "Henry Kim", company: "Summit Veterinary Partners", status: "lost", source: "Website" },
  { name: "Grace Wilson", company: "Willow Creek Assisted Living", status: "contacted", source: "Outbound" },
  { name: "Mateo Silva", company: "Atlas Fleet Services", status: "new", source: "Conference" },
  { name: "Zoe Bennett", company: "Pine & Lake Accounting", status: "proposal", source: "Referral" },
  { name: "Caleb Johnson", company: "Everwell Fitness Collective", status: "won", source: "Inbound" },
];

export function createDemoSeed(now = new Date()): SeedRecord {
  const leads = demoLeads.map((input, index) => {
    const id = `demo-lead-${String(index + 1).padStart(2, "0")}`;
    const createdAt = new Date(now.getTime() - (30 - index) * 86400000).toISOString();
    return {
      id,
      name: input.name,
      company: input.company,
      email: `${input.name.toLowerCase().replace(/\s+/g, ".")}@example.test`,
      status: input.status,
      source: input.source,
      createdAt,
      updatedAt: createdAt,
    };
  });

  const notes = leads.map((lead, index) => ({
    id: `demo-note-${String(index + 1).padStart(2, "0")}`,
    leadId: lead.id,
    body: `Synthetic discovery note: ${lead.name} asked about a ${index % 2 ? "quarterly" : "monthly"} review and requested a concise overview of the service options.`,
    createdAt: new Date(now.getTime() - (15 - index) * 86400000).toISOString(),
  }));

  const tasks = leads.map((lead, index) => {
    const createdAt = new Date(now.getTime() - (10 - index) * 86400000).toISOString();
    const offsetDays = index === 0 || index === 5 ? -2 : 2 + (index % 5);
    return {
      id: `demo-task-${String(index + 1).padStart(2, "0")}`,
      leadId: lead.id,
      title: index === 0 ? "Send property portfolio consultation options" : `Follow up with ${lead.name}`,
      dueAt: new Date(now.getTime() + offsetDays * 86400000).toISOString(),
      status: "pending" as const,
      createdAt,
      updatedAt: createdAt,
    };
  });

  return { leads, notes, tasks };
}