/**
 * Trace events — an append-only, hash-chained record of everything an agent did.
 * "git for browsing sessions" (Pillar 4). Chain is tamper-evident: each event's
 * hash covers the previous hash.
 */

export const TRACE_EVENT_TYPES = [
  "run.start",
  "step.thought",
  "step.action",
  "step.result",
  "permission.decision",
  "ir.snapshot",
  "screenshot",
  "network.summary",
  "run.end",
] as const;

export type TraceEventType = (typeof TRACE_EVENT_TYPES)[number];

export interface TraceEvent {
  /** Monotonic sequence number within the trace, starting at 0. */
  seq: number;
  ts: string;
  type: TraceEventType;
  payload: unknown;
  /** Hash of the previous event ("" for the first event). */
  prevHash: string;
  /** sha256 over `${seq}|${ts}|${type}|${stableJson(payload)}|${prevHash}`. */
  hash: string;
}

export interface TraceMeta {
  traceId: string;
  task: string;
  provider: string;
  engine: string;
  createdAt: string;
}
