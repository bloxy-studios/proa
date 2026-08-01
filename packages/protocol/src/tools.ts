import { z } from "zod";
import type { Capability } from "./capabilities.js";

/**
 * The agent tool surface — the SAME verbs everywhere: runtime, SDK, MCP, CLI.
 * If a capability exists only as pixels in the UI, it was built wrong (parity principle).
 */
export const TOOL_NAMES = [
  "navigate",
  "click",
  "type",
  "select",
  "scroll",
  "waitFor",
  "extract",
  "screenshot",
  "tabs.open",
  "tabs.close",
  "tabs.list",
  "download",
  "askHuman",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** Pseudo-tool the model emits to end a run cleanly. */
export const DONE_TOOL = "done" as const;

// ---- Per-tool parameter schemas (zod) ---------------------------------------

export const NavigateParams = z.object({ url: z.string().min(1) });
export const ClickParams = z.object({ ref: z.string().min(1) });
export const TypeParams = z.object({
  ref: z.string().min(1),
  text: z.string(),
  submit: z.boolean().optional(),
});
export const SelectParams = z.object({ ref: z.string().min(1), value: z.string() });
export const ScrollParams = z.object({
  direction: z.enum(["up", "down", "top", "bottom"]).default("down"),
  amount: z.number().int().positive().optional(),
});
export const WaitForParams = z.object({
  ref: z.string().optional(),
  text: z.string().optional(),
  timeoutMs: z.number().int().positive().default(5000),
});
export const ExtractParams = z.object({
  /** A SchemaSpec (see schema.ts), serialized as JSON. */
  schema: z.unknown(),
  instruction: z.string().optional(),
});
export const ScreenshotParams = z.object({ fullPage: z.boolean().optional() });
export const TabsOpenParams = z.object({ url: z.string().optional() });
export const TabsCloseParams = z.object({ tabId: z.string() });
export const TabsListParams = z.object({});
export const DownloadParams = z
  .object({ ref: z.string().optional(), url: z.string().optional() })
  .refine((v) => v.ref || v.url, { message: "download requires ref or url" });
export const AskHumanParams = z.object({ question: z.string().min(1) });
export const DoneParams = z.object({ summary: z.string() });

export const TOOL_PARAM_SCHEMAS = {
  navigate: NavigateParams,
  click: ClickParams,
  type: TypeParams,
  select: SelectParams,
  scroll: ScrollParams,
  waitFor: WaitForParams,
  extract: ExtractParams,
  screenshot: ScreenshotParams,
  "tabs.open": TabsOpenParams,
  "tabs.close": TabsCloseParams,
  "tabs.list": TabsListParams,
  download: DownloadParams,
  askHuman: AskHumanParams,
} as const satisfies Record<ToolName, z.ZodTypeAny>;

/**
 * Base capability a tool requires BEFORE per-node classification. The runtime may
 * escalate (e.g. clicking a "Delete account" button → irreversible). See permissions.
 */
export const TOOL_BASE_CAPABILITY: Record<ToolName, Capability> = {
  navigate: "read",
  "tabs.open": "read",
  "tabs.close": "read",
  "tabs.list": "read",
  scroll: "act:scroll",
  waitFor: "read",
  extract: "read",
  screenshot: "read",
  click: "act:click",
  type: "act:type",
  select: "act:select",
  download: "download",
  askHuman: "read",
};

export interface AgentAction {
  tool: ToolName | typeof DONE_TOOL;
  params: Record<string, unknown>;
}

export interface ActionResult {
  ok: boolean;
  summary: string;
  data?: unknown;
  error?: string;
  /** ref of the IR snapshot captured after this action, if any. */
  irRef?: string;
  /** ref of a screenshot captured after this action, if any. */
  screenshotRef?: string;
}
