import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";

const status = document.querySelector<HTMLElement>("#status")!;
const frame = document.querySelector<HTMLIFrameElement>("#crm")!;

async function start(): Promise<void> {
  const client = new Client({ name: "Sales CRM browser demo", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", window.location.href)));
  const resource = await client.readResource({ uri: "ui://sales-crm/v1/crm-dashboard.html" });
  const html = resource.contents.find((item) => "text" in item);
  if (!html || !("text" in html)) throw new Error("Dashboard resource is missing.");
  const bridge = new AppBridge(client, { name: "Sales CRM browser demo", version: "1.0.0" }, { serverTools: {} }, {
    hostContext: { theme: "light", platform: "web", locale: navigator.language, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  });
  bridge.oninitialized = () => { status.textContent = "Connected · Synthetic demo data"; };
  bridge.onerror = (error) => { status.textContent = error.message; };
  bridge.onsizechange = ({ height }) => { if (height !== undefined) frame.style.height = `${Math.max(700, height)}px`; };
  await bridge.connect(new PostMessageTransport(frame.contentWindow!, frame.contentWindow!));
  frame.srcdoc = html.text;
}

void start().catch((error: unknown) => {
  status.textContent = error instanceof Error ? error.message : "Could not connect to the CRM.";
});
