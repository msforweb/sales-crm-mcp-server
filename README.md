# sales-crm-mcp-server

A small, persistent sales CRM exposed through the official Model Context Protocol (MCP). It demonstrates the lead workflow from search through conversation notes, follow-up scheduling, pipeline updates, audit history, and an interactive MCP Apps view.

This server does not call an LLM or send email. It does not need an OpenAI API key. An AI client connected to it may have its own model or account requirements.

## Modes

The two modes are deliberately separate:

- **Demo mode** serves synthetic data only and requires both `CRM_MODE=demo` and `DEMO_MODE=true`. It has no authentication, so use it only with synthetic records and a temporary, trusted ChatGPT demonstration. It binds to loopback by default.
- **Authenticated mode** verifies bearer access tokens issued by an external OAuth/OIDC identity provider such as Keycloak. The server validates JWT signature, issuer, audience, expiration, and scopes; the verified token subject is the SQLite owner key. Read tools need `crm:read`; write tools need `crm:write`. Demo mode is disabled.

Keycloak is the authorization server. This repository is only an OAuth-compatible MCP resource server; it does not implement an authorization server or login flow.

## Capabilities

**Tools** perform CRM operations: `search_leads`, `get_lead`, `create_lead`, `update_lead_status`, `add_lead_note`, `create_followup_task`, `list_followup_tasks`, `complete_followup_task`, and `get_pipeline_summary`. Every tool has a Zod input schema, output schema, description, and behavior annotations. Business errors are reported as MCP tool errors.

**Resources** provide read-only `crm://pipeline/summary` JSON and the `crm://leads/{leadId}` template.

**Prompt** `prepare_lead_followup` reads real CRM context and asks the consuming client to draft a follow-up. CRM values are called out as untrusted data, with explicit instructions not to invent facts or send mail.

**MCP App UI** is served as an inline `text/html;profile=mcp-app` resource, using `_meta.ui.resourceUri` and the official `@modelcontextprotocol/ext-apps` bridge. It supports lead search, status filtering, selected lead details and notes, pending tasks, and task completion. The UI calls the same server tools as MCP clients. Demo mode also provides a browser host at `/` that loads this resource and forwards calls through MCP.

## Architecture

```text
src/
  auth/jwt.ts       Keycloak JWT verification and principal types
  config.ts         Environment validation and mode separation
  crm/              CRM types, validation, and business service
  db/               SQLite schema, repository, explicit demo seed
  mcp/server.ts     Shared tools, resources, prompt, and app resource
  http.ts           Streamable HTTP resource server and auth boundary
  stdio.ts          Local stdio entry point
  demo.ts           Official SDK child-process demonstration
web/                Bundled MCP Apps interface sources
tests/              Service and Streamable HTTP integration tests
```

SQLite uses foreign keys and indexes, parameterized queries, and transactions coupling every write with its audit event. Leads, notes, tasks, and audit events are scoped by `owner_id`. The demo seed uses the fixed synthetic owner `synthetic-demo`; startup never seeds, resets, or changes records.

The repository layer is the intended integration boundary for a later real CRM: preserve the service contract and replace SQLite operations with an authenticated vendor API client, carrying the verified subject and read/write authorization through every call.

## Setup and Commands

For the local browser demo, build the project, explicitly seed synthetic data,
and start HTTP with `CRM_MODE=demo DEMO_MODE=true`. Open
`http://127.0.0.1:3000/` to search leads, review notes, and complete follow-ups.
The demo host uses the official MCP client and Apps bridge with the same
dashboard resource used by connected clients. See [DEMO.md](DEMO.md) for commands.

Prerequisites: Node.js `>=22.12.0` (Node 22 LTS), npm, and a C/C++ toolchain if npm must compile the SQLite native binding.

```bash
npm install
cp .env.example .env
npm run typecheck
npm run build
npm test
npm run demo
```

The demo and tests use isolated temporary databases. For the local persistent portfolio database, explicitly seed it once:

```bash
npm run db:seed
```

Then run one of the following:

```bash
npm run dev:stdio       # stdio server for MCP clients; stdout is protocol-only
npm run dev:http        # Streamable HTTP at http://127.0.0.1:3000/mcp
npm start               # compiled stdio server
npm run start:http      # compiled HTTP server
```

Additional scripts: `npm run build:ui`, `npm run typecheck`, `npm run test:watch`, and `npm run demo`. `npm run demo` builds the project, launches the compiled stdio server with the official MCP client, and removes its temporary database afterward.

## Configuration

Copy `.env.example` to `.env`. `CRM_DATABASE_PATH` is resolved from the process working directory unless absolute. Database files, secrets, and build outputs are ignored by Git.

| Variable | Purpose |
| --- | --- |
| `CRM_MODE` | Required mode: `demo` or `authenticated`. |
| `DEMO_MODE` | Must be exactly `true` in demo mode; must not be true in authenticated mode. |
| `CRM_DATABASE_PATH` | SQLite file path; default `./data/sales-crm.sqlite`. |
| `HOST`, `PORT` | HTTP bind; defaults to `127.0.0.1:3000`. Non-loopback requires authenticated mode. |
| `ALLOWED_HOSTS` | Comma-separated exact host names; scheme and port are omitted. Default is localhost and loopback. |
| `ALLOWED_ORIGINS` | Comma-separated exact origins. Requests without `Origin` are allowed. |
| `OAUTH_ISSUER` | Exact configured Keycloak realm issuer URL. |
| `OAUTH_AUDIENCE` | Expected access-token `aud`; configure it as the MCP resource identifier. |
| `OAUTH_JWKS_URL` | Keycloak realm signing key endpoint. |
| `OAUTH_RESOURCE` | Canonical CRM resource identifier published to OAuth clients. |
| `OAUTH_AUTHORIZATION_SERVER` | Keycloak issuer listed in protected-resource metadata. |
| `AUTH_READ_SCOPE`, `AUTH_WRITE_SCOPE` | OAuth scopes, defaulting to `crm:read` and `crm:write`. |

Authenticated configuration fails at startup if any issuer, audience, JWKS URL, resource, or authorization-server URL is missing. Do not put tokens in logs or commit `.env`.

## Stdio and MCP Inspector

Stdio mode supports synthetic demo data only. It is suitable for desktop/local MCP clients and VS Code. Seed the local DB first if you want the portfolio records. The repository includes `.vscode/mcp.json`; build before using it. Logs go to stderr.

To inspect Streamable HTTP with the official Inspector:

```bash
npm run dev:http
npx @modelcontextprotocol/inspector@latest
```

Select **Streamable HTTP** and enter `http://localhost:3000/mcp`. For a tunnel URL, add its exact hostname to `ALLOWED_HOSTS` before starting the server.

## ChatGPT Connection Guide

ChatGPT supports custom MCP servers on the web where the account and workspace permit Developer mode/custom MCP plugins. Workspace administrators may disable the feature. The server can remain local; ChatGPT requires a reachable HTTPS URL or an available Secure MCP Tunnel.

### Synthetic Demo Mode

1. Ensure `.env` contains `CRM_MODE=demo` and `DEMO_MODE=true`; do not put private CRM data in this database.
2. Start `npm run dev:http` on its loopback default.
3. In another terminal, expose it with an HTTPS development tunnel, for example `cloudflared tunnel --url http://localhost:3000` (install Cloudflare Tunnel separately). Copy the generated hostname.
4. Stop and restart the MCP server with exact host/origin configuration. Example:

   ```bash
   ALLOWED_HOSTS="<tunnel-hostname>,localhost,127.0.0.1" \
   ALLOWED_ORIGINS="https://chatgpt.com" \
   npm run dev:http
   ```

   `ALLOWED_HOSTS` contains host names only, no scheme or path. `ALLOWED_ORIGINS` contains origins including scheme. No `Origin` header is permitted, while a supplied origin must match exactly. Add only origins actually used by the connecting client; never use `*`.
5. In ChatGPT web, open **Plugins** (`https://chatgpt.com/plugins`), choose **Add custom MCP server**, provide a name and `https://<tunnel-hostname>/mcp`, choose **No authentication**, accept the risk warning, and create it as a plugin. Install the resulting plugin in the appropriate personal/workspace catalog.
6. Start a new chat, type `@`, and select the CRM plugin. Try the prompts below.
7. After changing tools, descriptions, schemas, scopes, or UI assets, restart the server and use the connection’s **Refresh** action. Start a new chat to test updated tools.

ChatGPT account/workspace entitlement and workspace policies are separate from the server. The unauthenticated tunnel mode is for a short synthetic-data demo, not a public or private-data deployment.

### Authenticated Mode with Keycloak

Use a current supported Keycloak release as the OAuth/OIDC authorization server. Keycloak hosts authorization and token endpoints and signs user access tokens. This MCP server validates the resulting tokens as a resource server.

1. Create a dedicated Keycloak realm over HTTPS. Create restricted users and avoid sharing administrative accounts.
2. Create OAuth scopes `crm:read` and `crm:write` as client scopes, and configure them to appear in the access-token `scope` claim. Grant `crm:read` to reader roles and `crm:write` only to appropriate writer roles. Configure consent as required by the organization.
3. Create a service/audience identifier for the CRM, such as `https://crm.example.com`. Add an Audience protocol mapper to the applicable client scope so access tokens contain this exact custom audience. MCP client registration/token exchange must carry the OAuth `resource` parameter through authorization and token requests and produce this audience.
4. Configure the OAuth client-registration method selected in ChatGPT. Prefer a restricted Client ID Metadata Document flow if your Keycloak setup supports it; otherwise configure Keycloak’s client-registration endpoint with policies that allow only the required client metadata. Do not enable unrestricted anonymous client registration. If using a pre-registered client, supply the credentials through ChatGPT’s supported OAuth configuration rather than source code.
5. Configure Authorization Code flow with PKCE `S256`; disable Direct Access Grants and implicit flow. The exact redirect URI must be copied from the custom MCP connection’s ChatGPT management page into the Keycloak client's Valid Redirect URIs. Per current OpenAI auth guidance, the callback is `https://chatgpt.com/connector/oauth/<callback_id>` unless the authorization server correctly advertises RFC 9207 issuer identification and returns the exact matching `iss` on every success and error response. In that verified case ChatGPT uses `https://chatgpt.com/connector_platform_oauth_redirect`. Do not guess a callback ID or enable issuer-identification metadata unless the deployed Keycloak version/configuration actually satisfies RFC 9207.
6. Configure `.env` using the canonical HTTPS MCP origin as both `OAUTH_RESOURCE` and `OAUTH_AUDIENCE`, and the exact Keycloak realm issuer for `OAUTH_ISSUER` and `OAUTH_AUTHORIZATION_SERVER`. Set `OAUTH_JWKS_URL` to `<issuer>/protocol/openid-connect/certs`; set `CRM_MODE=authenticated`, `DEMO_MODE=false`, and configure public deployment `HOST` only with authenticated mode.
7. Set `ALLOWED_HOSTS` to the exact tunnel/production hostname. Set `ALLOWED_ORIGINS` only to observed/needed exact origins. Missing Origin is allowed. Restart and inspect protected-resource metadata and the `WWW-Authenticate` challenge before connecting ChatGPT.
8. In ChatGPT add the same `/mcp` URL and select **OAuth**. Complete the Keycloak authorization flow and inspect that a reader cannot write while a writer can.

This is a local OAuth resource-server integration guide, not a turnkey production identity deployment. Keycloak client-registration configuration varies by Keycloak version and administrator policy. Local bearer-token protection is not a complete OAuth solution for public deployment; keep Keycloak, MCP, TLS termination, registration policy, token revocation, monitoring, and CRM storage under a reviewed deployment design.

### Example Prompts

- “Search the CRM for qualified real estate leads and show the pending follow-ups.”
- “Open the Juniper Residential lead and summarize its notes and next task.”
- “Add a note to that lead: we discussed the synthetic portfolio review, and I will send options next week.”
- “Create a follow-up task for that lead due at 2026-10-10T15:00:00Z.”
- “Show the CRM lead desk interface and let me mark the follow-up complete.”
- “Use `prepare_lead_followup` for the Juniper Residential lead and draft an email for my review. Do not send it.”

### Manual ChatGPT UI Verification

**Pending.** No authenticated ChatGPT session was available in this environment. Passing the SDK demo or HTTP integration tests is not evidence that ChatGPT rendered the component. Verify manually:

- Add and install the custom MCP server from the ChatGPT web interface using its HTTPS tunnel URL and the intended authentication mode.
- In a new chat select the plugin with `@`; ask to show the CRM lead desk. Verify the inline search, status filter, lead list, selected lead details, notes, and pending follow-up tasks render without a blank frame or console error.
- Select a different lead and verify the details update from the CRM tool result.
- Complete a pending task from the embedded control. Verify the task disappears/changes in the widget and that a follow-up `get_lead` or `list_followup_tasks` confirms its persisted `completed` status.
- In authenticated mode verify a read-only token can search/read but cannot create a note or complete a task; verify another subject cannot see the first subject’s records.
- Restart the server and refresh the ChatGPT connection after tool/UI metadata changes. Repeat the UI and auth checks.

## Local Security Boundaries

- Demo mode is opt-in and has only synthetic records. The ordinary `npm run db:seed` command seeds only this demo owner and is idempotent.
- Authenticated mode requires validated Keycloak JWTs on HTTP requests that access private tools/resources/prompts. Authentication derives the owner solely from verified `sub`; tool input never accepts a user/owner selector.
- `crm:read` and `crm:write` are separate permissions, in both middleware and MCP tool metadata/challenges.
- Host checks prevent DNS-rebinding-style requests; Origin is checked when present, without requiring it for legitimate non-browser clients.
- HTTP binds to loopback by default. Non-loopback binds require authenticated mode. `/health` exposes only `{ "status": "ok" }`.
- The demo tunnel has no user authentication and any holder of its URL can access synthetic demo data and invoke writes. Shut it down after the demonstration.
- SQLite is local persistence, not a production multi-host CRM database. OAuth does not by itself make SQLite appropriate for high availability, compliance, or public deployment.

## Version and Documentation References

Verified from npm on 2026-10-07: `@modelcontextprotocol/server` **2.3.1**, `@modelcontextprotocol/client` **2.3.1**, `@modelcontextprotocol/node` **2.1.1** (peer dependency `@modelcontextprotocol/server ^2.3.0`), `@modelcontextprotocol/ext-apps` **2.0.3** (peer SDK `^2.0.0`, Zod `^4.2.0`), Zod **4.6.5**, Node.js **22.18.0**, and npm **10.9.3**. Exact installed versions are committed in `package-lock.json`.

- MCP SDK v2 documentation: https://ts.sdk.modelcontextprotocol.io/v2/
- MCP TypeScript SDK releases and examples: https://github.com/modelcontextprotocol/typescript-sdk
- MCP Apps overview/spec: https://modelcontextprotocol.io/extensions/apps/overview
- MCP Apps TypeScript helpers and bridge: https://github.com/modelcontextprotocol/ext-apps
- OpenAI MCP Apps in ChatGPT guide: https://developers.openai.com/plugins/build/chatgpt-ui/
- OpenAI custom MCP server connection guide: https://developers.openai.com/api/docs/guides/custom-mcp-server
- OpenAI custom MCP auth guide: https://developers.openai.com/plugins/build/auth/
- Keycloak administration guide: https://www.keycloak.org/docs/latest/server_admin/

OpenAI documents ChatGPT as supporting MCP Apps. The wider MCP client matrix notes that host support varies. Therefore the code uses the documented MCP Apps bridge and metadata, but ChatGPT UI rendering remains a manual verification item above.

[![M8ven Score](https://m8ven.ai/badge/mcp/msforweb-sales-crm-mcp-server-4pgyrv?v=b63fc81d0d3009245a1eebd9acdf4205)](https://m8ven.ai/mcp/msforweb-sales-crm-mcp-server-4pgyrv?s=readme)
