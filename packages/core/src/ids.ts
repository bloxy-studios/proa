import { randomBytes } from "node:crypto";

/** Short, sortable-ish trace id: <base36 time>-<random>. */
export function newTraceId(prefix = "t"): string {
  const t = Date.now().toString(36);
  const r = randomBytes(4).toString("hex");
  return `${prefix}-${t}-${r}`;
}
