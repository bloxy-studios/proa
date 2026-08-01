import type { TraceEvent, TraceEventType, TraceMeta } from "@proa/protocol";
import { hashEvent } from "./hash.js";

export interface ClockOptions {
  /** Injectable clock for deterministic tests. */
  now?: () => string;
}

/**
 * Builds an append-only, hash-chained trace in memory. The filesystem store
 * (see store.ts) persists these as JSONL. Every appended event's hash covers the
 * previous event's hash, so any edit to history is detectable.
 */
export class TraceWriter {
  readonly meta: TraceMeta;
  private readonly _events: TraceEvent[] = [];
  private readonly now: () => string;
  private onAppend?: (e: TraceEvent) => void;

  constructor(meta: TraceMeta, opts: ClockOptions & { onAppend?: (e: TraceEvent) => void } = {}) {
    this.meta = meta;
    this.now = opts.now ?? (() => new Date().toISOString());
    this.onAppend = opts.onAppend;
  }

  append(type: TraceEventType, payload: unknown): TraceEvent {
    const seq = this._events.length;
    const prevHash = seq === 0 ? "" : this._events[seq - 1]!.hash;
    const ts = this.now();
    const hash = hashEvent(seq, ts, type, payload, prevHash);
    const event: TraceEvent = { seq, ts, type, payload, prevHash, hash };
    this._events.push(event);
    this.onAppend?.(event);
    return event;
  }

  events(): readonly TraceEvent[] {
    return this._events;
  }

  get headHash(): string {
    return this._events.length ? this._events[this._events.length - 1]!.hash : "";
  }

  toJSONL(): string {
    const header = JSON.stringify({ kind: "proa.trace.meta", ...this.meta });
    const lines = this._events.map((e) => JSON.stringify(e));
    return [header, ...lines].join("\n") + "\n";
  }
}

export interface VerifyResult {
  ok: boolean;
  /** seq of the first event whose hash/chain is invalid, if any. */
  brokenAt?: number;
  reason?: string;
}

/** Recompute the hash chain and confirm it is intact (tamper-evident). */
export function verifyChain(events: readonly TraceEvent[]): VerifyResult {
  let prevHash = "";
  for (const e of events) {
    const expected = hashEvent(e.seq, e.ts, e.type, e.payload, prevHash);
    if (e.prevHash !== prevHash) {
      return { ok: false, brokenAt: e.seq, reason: "prevHash mismatch" };
    }
    if (e.hash !== expected) {
      return { ok: false, brokenAt: e.seq, reason: "hash mismatch (payload altered?)" };
    }
    prevHash = e.hash;
  }
  return { ok: true };
}
