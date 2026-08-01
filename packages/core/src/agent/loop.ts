import type {
  ActionResult,
  AgentAction,
  AgentStep,
  Artifact,
  Budget,
  Engine,
  EngineTab,
  ModelProvider,
  RunOutcome,
  RunStatus,
  SchemaSpec,
  ToolName,
} from "@proa/protocol";
import { DEFAULT_BUDGET, DONE_TOOL } from "@proa/protocol";
import { PermissionEngine, domainOf } from "@proa/permissions";
import type { TraceWriter } from "@proa/traces";
import { mapSchema } from "@proa/extractor";
import { AGENT_TOOLS_FOR_MODEL } from "../providers/prompt.js";

export interface RunAgentArgs {
  engine: Engine;
  provider: ModelProvider;
  task: string;
  permissions: PermissionEngine;
  trace: TraceWriter;
  budget?: Budget;
  tools?: ToolName[];
  agentId?: string;
  space?: string;
  startUrl?: string;
  onStep?: (step: AgentStep) => void;
  onThought?: (thought: string) => void;
  signal?: AbortSignal;
  /** Provide to answer askHuman inline; returning null ends the run as needs-human. */
  humanAnswer?: (question: string) => Promise<string | null>;
  now?: () => string;
}

/**
 * The agent loop: perceive (Page IR) → decide (provider) → gate (permissions) →
 * act (engine) → verify → repeat. Budgets are first-class; every step is traced. The
 * permission gate sits between decide and act, outside the model (ADR-0005).
 */
export async function runAgent(args: RunAgentArgs): Promise<RunOutcome> {
  const budget = args.budget ?? DEFAULT_BUDGET;
  const tools = args.tools ?? AGENT_TOOLS_FOR_MODEL;
  const agentId = args.agentId ?? "agent";
  const space = args.space ?? "default";
  const now = args.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const startMs = Date.now();
  const artifacts: Artifact[] = [];
  const history: AgentStep[] = [];

  args.trace.append("run.start", { task: args.task, budget, provider: args.provider.name });

  let current: EngineTab = await args.engine.openTab(args.startUrl);
  let status: RunStatus = "completed";
  let summary = "";
  let question: string | undefined;
  let steps = 0;
  let tokensUsed = 0;
  let costUsed = 0;

  const finish = (s: RunStatus, sum: string): RunOutcome => {
    status = s;
    summary = sum;
    const endedAt = now();
    args.trace.append("run.end", { status, summary, steps });
    return {
      status,
      summary,
      steps,
      traceId: args.trace.meta.traceId,
      startedAt,
      endedAt,
      artifacts,
      question,
    };
  };

  while (true) {
    if (args.signal?.aborted) return finish("stopped", "run stopped by user");
    if (steps >= budget.maxSteps) return finish("budget-exceeded", `max steps (${budget.maxSteps}) reached`);
    if (budget.maxWallClockMs && Date.now() - startMs > budget.maxWallClockMs) {
      return finish("budget-exceeded", "wall-clock budget exceeded");
    }
    if (budget.maxTokens && tokensUsed >= budget.maxTokens) {
      return finish("budget-exceeded", `token budget (${budget.maxTokens}) exhausted`);
    }
    if (budget.maxCostUsd && costUsed >= budget.maxCostUsd) {
      return finish("budget-exceeded", `cost budget ($${budget.maxCostUsd}) exhausted`);
    }

    const ir = await current.snapshot();
    args.trace.append("ir.snapshot", ir);

    const decision = await args.provider.decide({
      task: args.task,
      ir,
      history: history.map((h) => ({ thought: h.thought, action: h.action, result: h.result })),
      tools,
      budgetLeft: { steps: budget.maxSteps - steps },
    });
    args.trace.append("step.thought", { thought: decision.thought, usage: decision.usage });
    args.onThought?.(decision.thought);
    if (decision.usage) {
      tokensUsed += (decision.usage.inputTokens ?? 0) + (decision.usage.outputTokens ?? 0);
      costUsed += decision.usage.costUsd ?? 0;
    }

    const action = decision.action;
    if (action.tool === DONE_TOOL) {
      return finish("completed", String(action.params.summary ?? "task complete"));
    }

    const step: AgentStep = { index: steps, thought: decision.thought, action, startedAt: now() };
    args.trace.append("step.action", action);

    // ---- Permission gate (outside the model) --------------------------------
    const domain = domainOf((await current.getState()).url);
    const decisionP = await args.permissions.check({ agent: agentId, space, domain, action, ir });
    args.trace.append("permission.decision", {
      allowed: decisionP.allowed,
      capability: decisionP.capability,
      irreversible: decisionP.irreversible,
      remembered: decisionP.remembered,
      reason: decisionP.reason,
    });

    let result: ActionResult;
    if (!decisionP.allowed) {
      result = {
        ok: false,
        summary: `blocked by permission engine (${decisionP.capability}${
          decisionP.irreversible ? `/${decisionP.irreversible}` : ""
        }): ${decisionP.reason}`,
        error: "permission-denied",
      };
    } else {
      try {
        result = await dispatch(action, current, args, artifacts);
        if (action.tool === "tabs.open" && result.data && typeof result.data === "object") {
          const opened = (result.data as { tabId?: string }).tabId;
          if (opened) {
            const t = await args.engine.getTab(opened);
            if (t) current = t;
          }
        }
      } catch (err) {
        result = { ok: false, summary: `error: ${(err as Error).message}`, error: "engine-error" };
      }
    }

    args.trace.append("step.result", result);
    step.result = result;
    step.endedAt = now();
    history.push(step);
    args.onStep?.(step);
    steps++;

    if (action.tool === "askHuman") {
      const q = String(action.params.question ?? "");
      if (args.humanAnswer) {
        const ans = await args.humanAnswer(q);
        if (ans == null) {
          question = q;
          return finish("needs-human", `paused for human: ${q}`);
        }
        history[history.length - 1]!.result = { ok: true, summary: `human answered`, data: ans };
      } else {
        question = q;
        return finish("needs-human", `needs human: ${q}`);
      }
    }
  }
}

async function dispatch(
  action: AgentAction,
  tab: EngineTab,
  args: RunAgentArgs,
  artifacts: Artifact[],
): Promise<ActionResult> {
  const p = action.params;
  switch (action.tool) {
    case "navigate":
      await tab.navigate(String(p.url));
      return { ok: true, summary: `navigated to ${p.url}` };
    case "click":
      await tab.click(String(p.ref));
      return { ok: true, summary: `clicked ${p.ref}` };
    case "type":
      await tab.type(String(p.ref), String(p.text ?? ""), { submit: p.submit === true });
      return { ok: true, summary: `typed into ${p.ref}${p.submit ? " + submit" : ""}` };
    case "select":
      await tab.select(String(p.ref), String(p.value ?? ""));
      return { ok: true, summary: `selected ${p.value} in ${p.ref}` };
    case "scroll":
      await tab.scroll({ direction: (p.direction as "down") ?? "down", amount: p.amount as number });
      return { ok: true, summary: `scrolled ${p.direction ?? "down"}` };
    case "waitFor": {
      const found = await tab.waitFor({ ref: p.ref as string, text: p.text as string, timeoutMs: p.timeoutMs as number });
      return { ok: found, summary: found ? "condition met" : "wait timed out" };
    }
    case "extract": {
      const ir = await tab.snapshot();
      const spec = p.schema as SchemaSpec;
      const { value, confidence } = mapSchema(ir, spec);
      const artifact: Artifact = { kind: "json", name: "extract", ref: `extract-${artifacts.length}`, data: value };
      artifacts.push(artifact);
      return { ok: true, summary: `extracted (confidence ${confidence.toFixed(2)})`, data: value };
    }
    case "screenshot": {
      const shot = await tab.screenshot({ fullPage: p.fullPage === true });
      artifacts.push({ kind: "screenshot", name: "screenshot", ref: shot.ref });
      return { ok: true, summary: "screenshot captured", screenshotRef: shot.ref };
    }
    case "tabs.open": {
      const t = await args.engine.openTab(p.url ? String(p.url) : undefined);
      return { ok: true, summary: `opened tab ${t.id}`, data: { tabId: t.id } };
    }
    case "tabs.close": {
      const t = await args.engine.getTab(String(p.tabId));
      await t?.close();
      return { ok: true, summary: `closed ${p.tabId}` };
    }
    case "tabs.list": {
      const list = await args.engine.listTabs();
      return { ok: true, summary: `${list.length} tab(s)`, data: list.map((t) => t.id) };
    }
    case "download":
      return { ok: true, summary: "download quarantined pending grant", data: { quarantined: true } };
    case "askHuman":
      return { ok: true, summary: `asked: ${p.question}` };
    default:
      return { ok: false, summary: `unknown tool ${action.tool}`, error: "unknown-tool" };
  }
}
