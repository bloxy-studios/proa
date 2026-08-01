import { describe, it, expect } from "vitest";
import type { PageIR, TraceMeta } from "@proa/protocol";
import {
  TraceWriter,
  verifyChain,
  parseJSONL,
  Replayer,
  diffTraces,
  toPlaywrightTest,
} from "../src/index.js";

let clock = 0;
const now = () => new Date(clock++ * 1000).toISOString();

const meta: TraceMeta = {
  traceId: "t-test",
  task: "sign in",
  provider: "mock",
  engine: "dom",
  createdAt: new Date(0).toISOString(),
};

function sampleIR(): PageIR {
  return {
    url: "https://app.test/login",
    title: "Login",
    capturedAt: new Date(0).toISOString(),
    root: {
      ref: "n0",
      role: "document",
      children: [
        { ref: "n1", role: "textbox", name: "Username" },
        { ref: "n2", role: "textbox", name: "Password", state: { secret: true }, value: "•••" },
        { ref: "n3", role: "button", name: "Sign in" },
      ],
    },
    nodeCount: 4,
    tainted: false,
  };
}

function buildTrace(): TraceWriter {
  clock = 0;
  const w = new TraceWriter(meta, { now });
  w.append("run.start", { task: meta.task });
  w.append("ir.snapshot", sampleIR());
  w.append("step.thought", { thought: "type the username" });
  w.append("step.action", { tool: "type", params: { ref: "n1", text: "demo" } });
  w.append("step.action", { tool: "type", params: { ref: "n2", text: "s3cret", submit: false } });
  w.append("step.action", { tool: "click", params: { ref: "n3" } });
  w.append("run.end", { status: "completed" });
  return w;
}

describe("hash chain", () => {
  it("produces a verifiable chain", () => {
    const w = buildTrace();
    expect(verifyChain(w.events()).ok).toBe(true);
  });

  it("detects tampering with a payload", () => {
    const w = buildTrace();
    const events = structuredClone(w.events()) as ReturnType<TraceWriter["events"]>[number][];
    (events[3]!.payload as { params: { text: string } }).params.text = "attacker";
    const res = verifyChain(events);
    expect(res.ok).toBe(false);
    expect(res.brokenAt).toBe(3);
  });

  it("round-trips through JSONL", () => {
    const w = buildTrace();
    const parsed = parseJSONL(w.toJSONL());
    expect(parsed.meta.traceId).toBe("t-test");
    expect(verifyChain(parsed.events).ok).toBe(true);
  });
});

describe("replay & diff", () => {
  it("extracts a deterministic action sequence", () => {
    const w = buildTrace();
    const actions = new Replayer(w.events()).actions();
    expect(actions.map((a) => a.tool)).toEqual(["type", "type", "click"]);
  });

  it("diffs identical traces as identical", () => {
    const a = buildTrace();
    const b = buildTrace();
    expect(diffTraces(a.events(), b.events()).identical).toBe(true);
  });

  it("surfaces a divergence between runs", () => {
    const a = buildTrace();
    clock = 0;
    const b = new TraceWriter(meta, { now });
    b.append("ir.snapshot", sampleIR());
    b.append("step.action", { tool: "type", params: { ref: "n1", text: "different" } });
    const d = diffTraces(a.events(), b.events());
    expect(d.identical).toBe(false);
    expect(d.steps[0]!.field).toBe("params");
  });
});

describe("playwright export", () => {
  it("emits a runnable, stable-selector test and redacts secrets", () => {
    const w = buildTrace();
    const code = toPlaywrightTest(parseJSONL(w.toJSONL()));
    expect(code).toContain('import { test, expect } from "@playwright/test";');
    expect(code).toContain('page.getByRole("textbox", { name: "Username" }).fill("demo")');
    expect(code).toContain('page.getByRole("button", { name: "Sign in" }).click()');
    // The secret field must not leak its typed value into the exported test.
    expect(code).not.toContain("s3cret");
    expect(code).toContain("PROA_SECRET");
  });
});
