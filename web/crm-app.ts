import { App } from "@modelcontextprotocol/ext-apps";

type Lead = { id: string; name: string; company: string; email: string; status: string; source: string; createdAt: string };
type Task = { id: string; leadId: string; title: string; dueAt: string; status: string };
type Note = { id: string; body: string; createdAt: string };
type LeadDetails = Lead & { notes: Note[]; tasks: Task[] };
type SearchResult = { items: Lead[]; pagination: { total: number; limit: number; offset: number; hasMore: boolean } };
type ToolResponse = { structuredContent?: unknown; content?: Array<{ type: string; text?: string }>; isError?: boolean };

const app = new App({ name: "Sales CRM Lead Desk", version: "1.0.0" });
const queryInput = document.querySelector<HTMLInputElement>("#query")!;
const statusSelect = document.querySelector<HTMLSelectElement>("#status")!;
const resultsElement = document.querySelector<HTMLElement>("#results")!;
const detailElement = document.querySelector<HTMLElement>("#detail")!;
const messageElement = document.querySelector<HTMLElement>("#message")!;
const resultCount = document.querySelector<HTMLElement>("#result-count")!;
const pageLabel = document.querySelector<HTMLElement>("#page-label")!;
const connectionElement = document.querySelector<HTMLElement>("#connection")!;
const previousButton = document.querySelector<HTMLButtonElement>("#previous")!;
const nextButton = document.querySelector<HTMLButtonElement>("#next")!;
const pageSize = 8;
let offset = 0;
let hasMore = false;
let selectedLeadId: string | undefined;

function escapeText(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function getData<T>(result: ToolResponse): T {
  if (result.isError) throw new Error(result.content?.find((item) => item.type === "text")?.text ?? "CRM request failed.");
  if (result.structuredContent) return result.structuredContent as T;
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("The CRM returned no data.");
  return JSON.parse(text) as T;
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function showMessage(value: string, isError = false): void {
  messageElement.textContent = value;
  messageElement.classList.toggle("error", isError);
  messageElement.classList.toggle("visible", Boolean(value));
}

function renderResults(page: SearchResult): void {
  hasMore = page.pagination.hasMore;
  resultCount.textContent = String(page.pagination.total);
  pageLabel.textContent = `Page ${Math.floor(offset / pageSize) + 1}`;
  previousButton.disabled = offset === 0;
  nextButton.disabled = !hasMore;
  if (page.items.length === 0) {
    resultsElement.innerHTML = '<p class="list-empty">No leads match these filters.</p>';
    return;
  }
  resultsElement.innerHTML = page.items.map((lead) => `
    <button class="lead-row ${lead.id === selectedLeadId ? "selected" : ""}" type="button" data-lead-id="${escapeText(lead.id)}">
      <span class="avatar">${escapeText(lead.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase())}</span>
      <span class="lead-copy"><strong>${escapeText(lead.name)}</strong><span>${escapeText(lead.company)}</span></span>
      <span class="status status-${escapeText(lead.status)}">${escapeText(lead.status)}</span>
    </button>`).join("");
  resultsElement.querySelectorAll<HTMLButtonElement>("[data-lead-id]").forEach((button) => {
    button.addEventListener("click", () => void selectLead(button.dataset.leadId!));
  });
}

function renderDetail(lead: LeadDetails): void {
  const pendingTasks = lead.tasks.filter((task) => task.status === "pending");
  const notes = [...lead.notes].reverse();
  detailElement.innerHTML = `
    <div class="lead-overview">
      <div class="lead-title-line"><div><p class="eyebrow">LEAD PROFILE</p><h2>${escapeText(lead.name)}</h2></div><span class="status status-${escapeText(lead.status)}">${escapeText(lead.status)}</span></div>
      <p class="company-line">${escapeText(lead.company)}</p>
      <div class="contact-grid"><div><span class="field-label">EMAIL</span><a href="mailto:${escapeText(lead.email)}">${escapeText(lead.email)}</a></div><div><span class="field-label">SOURCE</span><span>${escapeText(lead.source)}</span></div><div><span class="field-label">ADDED</span><span>${escapeText(dateLabel(lead.createdAt))}</span></div></div>
    </div>
    <section class="detail-section"><div class="section-heading"><h3>Pending follow-ups</h3><span class="result-count">${pendingTasks.length}</span></div>
      ${pendingTasks.length ? `<ul class="task-list">${pendingTasks.map((task) => `<li class="task-row"><span class="task-mark" aria-hidden="true">◷</span><div class="task-copy"><strong>${escapeText(task.title)}</strong><span>Due ${escapeText(dateLabel(task.dueAt))}</span></div><button class="complete-button" type="button" data-task-id="${escapeText(task.id)}" aria-label="Complete ${escapeText(task.title)}" title="Mark task complete">✓</button></li>`).join("")}</ul>` : '<p class="quiet-empty">No pending follow-up tasks.</p>'}
    </section>
    <section class="detail-section notes-section"><div class="section-heading"><h3>Conversation notes</h3><span class="result-count">${notes.length}</span></div>
      ${notes.length ? `<ul class="note-list">${notes.map((note) => `<li><p>${escapeText(note.body)}</p><time>${escapeText(dateLabel(note.createdAt))}</time></li>`).join("")}</ul>` : '<p class="quiet-empty">No conversation notes yet.</p>'}
    </section>`;
  detailElement.querySelectorAll<HTMLButtonElement>("[data-task-id]").forEach((button) => {
    button.addEventListener("click", () => void completeTask(button.dataset.taskId!));
  });
}

async function searchLeads(): Promise<void> {
  showMessage("");
  resultsElement.innerHTML = '<p class="list-empty">Searching CRM…</p>';
  try {
    const result = await app.callServerTool({
      name: "search_leads",
      arguments: { query: queryInput.value.trim() || undefined, status: statusSelect.value || undefined, limit: pageSize, offset },
    });
    const page = getData<SearchResult>(result as ToolResponse);
    renderResults(page);
    if (selectedLeadId && !page.items.some((lead) => lead.id === selectedLeadId)) {
      selectedLeadId = undefined;
      showEmptyDetail();
    }
  } catch (error) {
    resultsElement.innerHTML = '<p class="list-empty">Could not load leads.</p>';
    showMessage(error instanceof Error ? error.message : "Could not load leads.", true);
  }
}

function showEmptyDetail(): void {
  detailElement.innerHTML = '<div class="empty-state"><div class="empty-icon" aria-hidden="true">↗</div><h2>Select a lead</h2><p>Choose a result to review its history and next steps.</p></div>';
}

async function selectLead(leadId: string): Promise<void> {
  selectedLeadId = leadId;
  await searchLeads();
  detailElement.innerHTML = '<p class="list-empty">Loading lead details…</p>';
  try {
    const result = await app.callServerTool({ name: "get_lead", arguments: { leadId } });
    renderDetail(getData<LeadDetails>(result as ToolResponse));
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "Could not load lead details.", true);
    showEmptyDetail();
  }
}

async function completeTask(taskId: string): Promise<void> {
  const button = detailElement.querySelector<HTMLButtonElement>(`[data-task-id="${CSS.escape(taskId)}"]`);
  if (button) button.disabled = true;
  try {
    const result = await app.callServerTool({ name: "complete_followup_task", arguments: { taskId } });
    getData<Task>(result as ToolResponse);
    if (selectedLeadId) await selectLead(selectedLeadId);
    showMessage("Follow-up marked complete.");
  } catch (error) {
    if (button) button.disabled = false;
    showMessage(error instanceof Error ? error.message : "Could not complete task.", true);
  }
}

document.querySelector<HTMLButtonElement>("#search")!.addEventListener("click", () => { offset = 0; void searchLeads(); });
queryInput.addEventListener("keydown", (event) => { if (event.key === "Enter") { offset = 0; void searchLeads(); } });
statusSelect.addEventListener("change", () => { offset = 0; void searchLeads(); });
previousButton.addEventListener("click", () => { offset = Math.max(0, offset - pageSize); void searchLeads(); });
nextButton.addEventListener("click", () => { if (hasMore) { offset += pageSize; void searchLeads(); } });

app.onerror = (error) => showMessage(error.message, true);
app.ontoolresult = (result) => {
  const data = result.structuredContent as SearchResult | undefined;
  if (data && Array.isArray(data.items) && data.pagination) renderResults(data);
};
app.connect().then(() => {
  connectionElement.innerHTML = '<span></span> Connected';
  connectionElement.classList.add("connected");
  return searchLeads();
}).catch(() => {
  connectionElement.innerHTML = '<span></span> Offline';
  showMessage("Connect this MCP App to the Sales CRM server to load lead data.", true);
});
