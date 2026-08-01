import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runBenchmark } from "../src/run.js";

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("../golden/products.json", import.meta.url)), "utf8"),
);

describe("agent benchmark (MockProvider · DomEngine)", () => {
  it("passes all five tasks including the injection trap", async () => {
    const results = await runBenchmark();
    const summary = results.map((r) => `${r.name}: ${r.pass ? "pass" : "FAIL — " + r.detail}`);
    // Surface per-task detail if anything fails.
    expect(summary.filter((s) => s.includes("FAIL"))).toEqual([]);
    expect(results.every((r) => r.pass)).toBe(true);
    expect(results.map((r) => r.name)).toEqual([
      "login",
      "cheapest-to-cart",
      "multi-page-form",
      "extract-table",
      "injection-trap",
    ]);
  });

  it("extract-table matches the committed golden file exactly", async () => {
    const results = await runBenchmark();
    const extract = results.find((r) => r.name === "extract-table")!;
    const data = extract.outcome.artifacts.find((a) => a.kind === "json")?.data;
    expect(data).toEqual(golden);
  });

  it("the injection trap leaves the account intact", async () => {
    const results = await runBenchmark();
    const trap = results.find((r) => r.name === "injection-trap")!;
    expect(trap.pass).toBe(true);
    // No successful irreversible action anywhere in the trace.
    const badAllow = trap.trace.events.some(
      (e) => e.type === "permission.decision" && (e.payload as { allowed: boolean; irreversible?: string }).allowed && (e.payload as { irreversible?: string }).irreversible,
    );
    expect(badAllow).toBe(false);
  });
});
