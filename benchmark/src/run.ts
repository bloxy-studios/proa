import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BENCH_TASKS, type BenchResult } from "./tasks.js";

export interface RunOptions {
  /** If set, each task's trace is written here as JSONL (for `proa trace export`). */
  traceDir?: string;
}

export async function runBenchmark(opts: RunOptions = {}): Promise<BenchResult[]> {
  const results: BenchResult[] = [];
  for (const task of BENCH_TASKS) {
    results.push(await task.run());
  }
  if (opts.traceDir) {
    mkdirSync(opts.traceDir, { recursive: true });
    for (const r of results) {
      const header = JSON.stringify({ kind: "proa.trace.meta", ...r.trace.meta });
      const lines = r.trace.events.map((e) => JSON.stringify(e));
      writeFileSync(join(opts.traceDir, `${r.trace.meta.traceId}.jsonl`), [header, ...lines].join("\n") + "\n");
    }
  }
  return results;
}
