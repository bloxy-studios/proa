import type { AgentAction, PageIR, TraceEvent } from "@proa/protocol";

/** Pull the ordered action sequence out of a trace. */
export function extractActions(events: readonly TraceEvent[]): AgentAction[] {
  return events
    .filter((e) => e.type === "step.action")
    .map((e) => e.payload as AgentAction);
}

/** Pull the ordered IR snapshots out of a trace. */
export function extractSnapshots(events: readonly TraceEvent[]): PageIR[] {
  return events.filter((e) => e.type === "ir.snapshot").map((e) => e.payload as PageIR);
}

export interface ReplayStep {
  action: AgentAction;
  /** The IR snapshot the agent perceived immediately before choosing this action. */
  irBefore?: PageIR;
}

/**
 * Deterministic replayer. Walks the trace in order and pairs each action with the IR
 * snapshot that preceded it — the substrate for the "diff two runs" and "export to
 * Playwright" features, and for re-executing a run against a live engine.
 */
export class Replayer {
  constructor(private readonly events: readonly TraceEvent[]) {}

  actions(): AgentAction[] {
    return extractActions(this.events);
  }

  steps(): ReplayStep[] {
    const out: ReplayStep[] = [];
    let currentIR: PageIR | undefined;
    for (const e of this.events) {
      if (e.type === "ir.snapshot") currentIR = e.payload as PageIR;
      else if (e.type === "step.action") {
        out.push({ action: e.payload as AgentAction, irBefore: currentIR });
      }
    }
    return out;
  }
}
