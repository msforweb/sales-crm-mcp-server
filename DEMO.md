# Five-Minute Client Demo

Use synthetic demo mode for the walk-through. This script demonstrates CRM behavior and MCP integration; it does not connect to a real CRM or send email.

## Before the Demo

For a local visual demo with no ChatGPT setup, run:

```bash
npm run build
CRM_MODE=demo DEMO_MODE=true npm run db:seed
CRM_MODE=demo DEMO_MODE=true npm run start:http
```

Open http://127.0.0.1:3000 in your browser. Search for Juniper Residential,
select the lead, and complete a pending task. The browser host loads the same
MCP App resource and forwards its actions through the official MCP client and
Apps bridge to `/mcp`. This page is available only in synthetic demo mode.
The persistent database is not reset when you restart or seed again.

```bash
npm install
npm run build
npm run db:seed
npm run dev:http
```

For ChatGPT, expose the loopback server through a short-lived HTTPS tunnel and add the tunnel hostname to `ALLOWED_HOSTS`. Connect it in ChatGPT as a custom MCP server with **No authentication**. Use synthetic data only and stop the tunnel afterward.

## Presentation

1. **Business problem.** Sales context is scattered across notes, statuses, and reminders. The CRM offers one persistent source of truth with narrow actions the AI client can request; the server does not make sales decisions or send messages.
2. **Capability discovery.** In ChatGPT or MCP Inspector, show the tools, `crm://pipeline/summary`, the `crm://leads/{leadId}` resource template, and `prepare_lead_followup` prompt.
3. **Search and inspect.** Ask: “Search for qualified real estate leads, then inspect Juniper Residential.” Review the synthetic lead status, notes, and its pending task.
4. **Record the conversation.** Ask to add a concise note and create a follow-up due at a timezone-qualified ISO timestamp. Review the write-tool confirmation and arguments before approving.
5. **Persisted data and audit.** Update its status to proposal, read the lead again, and show that its note, task, and status are present. Restart the local server and reread the lead. To inspect audit events directly during a client walkthrough, use the SQLite CLI on the configured database; audit data is intentionally not exposed as an arbitrary-SQL MCP tool.
6. **AI-assisted draft.** Ask the client to retrieve `prepare_lead_followup` and draft a message based only on the lead’s recorded context. Confirm it does not invent claims and requires user review. The server itself does not call an LLM or send email.

## Verification Status

The automated SDK demo (`npm run demo`) launches the compiled stdio server as a subprocess and verifies tool/resource/template/prompt discovery, seeded lead search/read, note/task/status mutations, a resource read, prompt retrieval, audit writes, and persistence in an isolated temporary database. The HTTP integration suite uses the real SDK client and ephemeral ports, and tests auth boundaries and owner isolation.

**ChatGPT UI verification is pending.** SDK tests do not prove that ChatGPT’s hosted iframe rendered the app or that its current account/workspace configuration allows custom MCP servers. Follow the manual ChatGPT checklist in the README and record that as a separate client-side result.

Local browser verification passed on 2026-10-09 in headless Chrome: dashboard
styling, MCP Apps bridge connection, lead search, lead details, failed-completion
error feedback, and successful persisted task completion. This verifies the local
demo host; ChatGPT rendering and live Keycloak login remain separate checks.
