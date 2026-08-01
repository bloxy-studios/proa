/**
 * The MCP tool surface. Mirrors the SDK/CLI verbs exactly (parity principle). Kept as
 * plain data so it can be golden-tested without pulling in the MCP SDK.
 */
export interface ToolParam {
  type: "string" | "number" | "boolean" | "object";
  required?: boolean;
  description?: string;
}

export interface ProaToolDef {
  name: string;
  description: string;
  params: Record<string, ToolParam>;
}

export const TOOL_DEFS: ProaToolDef[] = [
  { name: "ping", description: "Health check.", params: {} },
  { name: "tabs.open", description: "Open a tab (optionally at a URL). Visible in the app by default.", params: { url: { type: "string" } } },
  { name: "tabs.close", description: "Close a tab.", params: { tabId: { type: "string", required: true } } },
  { name: "tabs.list", description: "List open tab ids.", params: {} },
  { name: "navigate", description: "Load a URL in a tab.", params: { url: { type: "string", required: true }, tabId: { type: "string" } } },
  { name: "ir", description: "Get the Page IR for a tab.", params: { tabId: { type: "string" } } },
  { name: "click", description: "Click an IR node by ref (gated by the permission engine).", params: { ref: { type: "string", required: true }, tabId: { type: "string" } } },
  { name: "type", description: "Type into an IR node (gated).", params: { ref: { type: "string", required: true }, text: { type: "string", required: true }, submit: { type: "boolean" }, tabId: { type: "string" } } },
  { name: "select", description: "Select an option (gated).", params: { ref: { type: "string", required: true }, value: { type: "string", required: true }, tabId: { type: "string" } } },
  { name: "scroll", description: "Scroll the page.", params: { direction: { type: "string" }, amount: { type: "number" }, tabId: { type: "string" } } },
  { name: "waitFor", description: "Wait for text or a node.", params: { text: { type: "string" }, ref: { type: "string" }, timeoutMs: { type: "number" }, tabId: { type: "string" } } },
  { name: "extract", description: "Extract typed JSON from a page using a SchemaSpec.", params: { schema: { type: "object", required: true }, tabId: { type: "string" } } },
  { name: "screenshot", description: "Capture a screenshot.", params: { fullPage: { type: "boolean" }, tabId: { type: "string" } } },
  { name: "download", description: "Download a file (quarantined, gated).", params: { url: { type: "string" }, ref: { type: "string" }, tabId: { type: "string" } } },
  { name: "agent.run", description: "Run the in-browser agent on a task; returns the outcome and full trace.", params: { task: { type: "string", required: true }, startUrl: { type: "string" }, maxSteps: { type: "number" } } },
  { name: "agent.stop", description: "Stop the active agent run.", params: {} },
  { name: "ledger", description: "Read the permission/audit ledger, optionally by domain and Space.", params: { domain: { type: "string" }, space: { type: "string" } } },
];

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);
