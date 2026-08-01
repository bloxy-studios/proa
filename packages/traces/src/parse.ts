import type { TraceEvent, TraceMeta } from "@proa/protocol";

export interface ParsedTrace {
  meta: TraceMeta;
  events: TraceEvent[];
}

/** Parse a JSONL trace (first line = meta header, remaining lines = events). */
export function parseJSONL(text: string): ParsedTrace {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error("empty trace");
  const header = JSON.parse(lines[0]!) as { kind?: string } & TraceMeta;
  if (header.kind !== "proa.trace.meta") {
    throw new Error("first line is not a proa.trace.meta header");
  }
  const { kind: _kind, ...meta } = header;
  const events = lines.slice(1).map((l) => JSON.parse(l) as TraceEvent);
  return { meta: meta as TraceMeta, events };
}
