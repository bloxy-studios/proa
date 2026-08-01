import { createHash } from "node:crypto";

/** Deterministic JSON: object keys sorted recursively. Arrays keep order. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v as Record<string, unknown>).sort()) {
      out[key] = sortValue((v as Record<string, unknown>)[key]);
    }
    return out;
  }
  return v;
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Hash for one trace event, chaining the previous hash. */
export function hashEvent(
  seq: number,
  ts: string,
  type: string,
  payload: unknown,
  prevHash: string,
): string {
  return sha256(`${seq}|${ts}|${type}|${stableStringify(payload)}|${prevHash}`);
}
