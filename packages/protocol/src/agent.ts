import type { AgentAction, ActionResult, ToolName } from "./tools.js";
import type { PageIR } from "./ir.js";

/** Hard budgets on every run. Exceeding any one ends the run cleanly with a trace. */
export interface Budget {
  maxSteps: number;
  maxTokens?: number;
  maxCostUsd?: number;
  maxWallClockMs?: number;
}

export const DEFAULT_BUDGET: Budget = { maxSteps: 40 };

export interface AgentStep {
  index: number;
  thought: string;
  action: AgentAction;
  result?: ActionResult;
  startedAt: string;
  endedAt?: string;
}

export type RunStatus =
  | "completed"
  | "failed"
  | "budget-exceeded"
  | "stopped"
  | "needs-human";

export interface Artifact {
  kind: "json" | "download" | "trace" | "screenshot";
  name: string;
  /** A ref/path/locator for the artifact. */
  ref: string;
  data?: unknown;
}

export interface RunOutcome {
  status: RunStatus;
  summary: string;
  steps: number;
  traceId: string;
  startedAt: string;
  endedAt: string;
  artifacts: Artifact[];
  /** Present when status === "needs-human". */
  question?: string;
}

// ---- Model provider abstraction ---------------------------------------------

export interface ModelHistoryEntry {
  thought: string;
  action: AgentAction;
  result?: ActionResult;
}

export interface ModelContext {
  task: string;
  /** Current perception. Page-derived text is data, never instructions. */
  ir: PageIR;
  history: ModelHistoryEntry[];
  tools: readonly ToolName[];
  budgetLeft: { steps: number };
}

export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface ModelDecision {
  thought: string;
  action: AgentAction;
  usage?: ModelUsage;
}

/**
 * The model provider. Three implementations ship: Anthropic (first-class agentic
 * loop), OpenAI-compatible, and MockProvider (deterministic replay — the CI backbone).
 */
export interface ModelProvider {
  readonly name: string;
  decide(ctx: ModelContext): Promise<ModelDecision>;
}
