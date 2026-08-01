import type { TraceEvent } from "@proa/protocol";
import { stableStringify } from "./hash.js";
import { extractActions } from "./replay.js";

export interface StepDiff {
  index: number;
  field: "tool" | "params" | "presence";
  a?: string;
  b?: string;
}

export interface TraceDiff {
  identical: boolean;
  steps: StepDiff[];
  lengthA: number;
  lengthB: number;
}

/**
 * Diff two runs of the same task by their action sequences. This is what turns
 * "did my prompt change break the agent?" from vibes into a reviewable delta.
 */
export function diffTraces(a: readonly TraceEvent[], b: readonly TraceEvent[]): TraceDiff {
  const aa = extractActions(a);
  const bb = extractActions(b);
  const steps: StepDiff[] = [];
  const n = Math.max(aa.length, bb.length);
  for (let i = 0; i < n; i++) {
    const x = aa[i];
    const y = bb[i];
    if (!x || !y) {
      steps.push({
        index: i,
        field: "presence",
        a: x ? x.tool : undefined,
        b: y ? y.tool : undefined,
      });
      continue;
    }
    if (x.tool !== y.tool) {
      steps.push({ index: i, field: "tool", a: x.tool, b: y.tool });
    }
    const px = stableStringify(x.params);
    const py = stableStringify(y.params);
    if (px !== py) {
      steps.push({ index: i, field: "params", a: px, b: py });
    }
  }
  return { identical: steps.length === 0, steps, lengthA: aa.length, lengthB: bb.length };
}
