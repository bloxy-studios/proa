import type { z } from "zod";
import type { AgentStep, PageIR, RunOutcome, TraceEvent } from "@proa/protocol";
import type { LedgerEntry } from "@proa/permissions";
import type { ParsedTrace } from "@proa/traces";
import { extractActions } from "@proa/traces";
import { zodToSchemaSpec } from "./zod.js";
import type { AgentRun, ProaApp, RunOptions, Tab } from "./app.js";

export interface ConnectOptions {
  /** Base URL of a running Proa's HTTP bridge. Defaults to $PROA_ENDPOINT or localhost. */
  endpoint?: string;
  token?: string;
}

/**
 * A ProaApp that drives a RUNNING Proa (the desktop app or `proa mcp serve`) over its HTTP
 * bridge — the "watch real windows while your script drives them" story. Tool verbs mirror
 * the SDK/MCP surface exactly (parity principle).
 */
async function call<T>(opts: Required<Pick<ConnectOptions, "endpoint">> & ConnectOptions, tool: string, params: unknown): Promise<T> {
  const res = await fetch(`${opts.endpoint.replace(/\/$/, "")}/call`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: JSON.stringify({ tool, params }),
  });
  if (!res.ok) throw new Error(`Proa bridge ${tool} -> ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { ok: boolean; result?: T; error?: string };
  if (!data.ok) throw new Error(data.error ?? `${tool} failed`);
  return data.result as T;
}

class RemoteTab implements Tab {
  constructor(
    readonly id: string,
    private readonly opts: Required<Pick<ConnectOptions, "endpoint">> & ConnectOptions,
  ) {}
  async goto(url: string) {
    await call(this.opts, "navigate", { tabId: this.id, url });
  }
  ir() {
    return call<PageIR>(this.opts, "ir", { tabId: this.id });
  }
  async extract<T>(schema: z.ZodType<T>): Promise<T> {
    const spec = zodToSchemaSpec(schema as z.ZodTypeAny);
    const value = await call<unknown>(this.opts, "extract", { tabId: this.id, schema: spec });
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : (value as T);
  }
  async screenshot(o?: { fullPage?: boolean }) {
    return call<{ ref: string }>(this.opts, "screenshot", { tabId: this.id, ...o });
  }
  async close() {
    await call(this.opts, "tabs.close", { tabId: this.id });
  }
}

class RemoteAgentRun implements AgentRun {
  private outcome: Promise<{ outcome: RunOutcome; trace: ParsedTrace }>;
  private parsed?: ParsedTrace;
  private opts: Required<Pick<ConnectOptions, "endpoint">> & ConnectOptions;
  constructor(opts: Required<Pick<ConnectOptions, "endpoint">> & ConnectOptions, task: string, runOpts: RunOptions) {
    this.opts = opts;
    this.outcome = call<{ outcome: RunOutcome; trace: ParsedTrace }>(opts, "agent.run", {
      task,
      budget: runOpts.budget,
      tools: runOpts.tools,
      space: runOpts.space,
      startUrl: runOpts.startUrl,
    }).then((r) => {
      this.parsed = r.trace;
      return r;
    });
  }
  async *steps(): AsyncIterable<AgentStep> {
    const { trace } = await this.outcome;
    const actions = extractActions(trace.events);
    const thoughts = trace.events.filter((e: TraceEvent) => e.type === "step.thought");
    for (let i = 0; i < actions.length; i++) {
      yield {
        index: i,
        thought: (thoughts[i]?.payload as { thought?: string } | undefined)?.thought ?? "",
        action: actions[i]!,
        startedAt: "",
      };
    }
  }
  async result() {
    return (await this.outcome).outcome;
  }
  trace(): ParsedTrace {
    if (!this.parsed) throw new Error("trace not available until the run resolves");
    return this.parsed;
  }
  stop() {
    void call(this.opts, "agent.stop", {});
  }
}

/** Connect to a running Proa over its HTTP bridge. */
export async function connect(options: ConnectOptions = {}): Promise<ProaApp> {
  const endpoint = options.endpoint ?? process.env.PROA_ENDPOINT ?? "http://127.0.0.1:8787";
  const opts = { ...options, endpoint };
  // Fail fast if nothing is listening.
  await call(opts, "ping", {}).catch((e) => {
    throw new Error(
      `Could not reach a running Proa at ${endpoint}. Start one with \`proa mcp serve --http\` or open the app. (${(e as Error).message})`,
    );
  });
  return {
    engineName: "remote",
    tabs: {
      open: async (url?: string) => {
        const { tabId } = await call<{ tabId: string }>(opts, "tabs.open", { url });
        const t = new RemoteTab(tabId, opts);
        if (url) await t.goto(url);
        return t;
      },
      list: async () => {
        const ids = await call<string[]>(opts, "tabs.list", {});
        return ids.map((id) => new RemoteTab(id, opts));
      },
    },
    agents: {
      run: (task: string, runOpts: RunOptions = {}) => new RemoteAgentRun(opts, task, runOpts),
    },
    ledger: (domain?: string, space?: string) => call<LedgerEntry[]>(opts, "ledger", { domain, space }),
    close: async () => {
      /* remote app owns its lifecycle */
    },
  };
}
