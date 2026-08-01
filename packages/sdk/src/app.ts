import type { z } from "zod";
import type {
  AgentStep,
  Budget,
  Engine,
  EngineTab,
  ModelProvider,
  PageIR,
  RunOutcome,
  ToolName,
} from "@proa/protocol";
import { DomEngine, MockProvider, runAgent, newTraceId, type Resolver } from "@proa/core";
import { AnthropicProvider } from "@proa/core";
import type { LedgerEntry } from "@proa/permissions";
import { PermissionEngine } from "@proa/permissions";
import { TraceWriter, type ParsedTrace } from "@proa/traces";
import { mapSchema } from "@proa/core";
import { zodToSchemaSpec } from "./zod.js";
import { engineFromSpec, isPermissionEngine, type PermissionsSpec } from "./permissions.js";

export interface Tab {
  readonly id: string;
  goto(url: string): Promise<void>;
  ir(): Promise<PageIR>;
  /** Turn the current page into typed JSON matching a zod schema (Page IR → schema). */
  extract<T>(schema: z.ZodType<T>): Promise<T>;
  screenshot(opts?: { fullPage?: boolean }): Promise<{ ref: string }>;
  close(): Promise<void>;
}

export interface RunOptions {
  budget?: Budget;
  tools?: ToolName[];
  provider?: ModelProvider;
  permissions?: PermissionEngine | PermissionsSpec;
  space?: string;
  agentId?: string;
  startUrl?: string;
}

export interface AgentRun {
  /** Stream `thought → action → result` steps as they happen. */
  steps(): AsyncIterable<AgentStep>;
  /** Await the final outcome (also resolves when steps() is exhausted). */
  result(): Promise<RunOutcome>;
  /** The trace being recorded for this run. */
  trace(): ParsedTrace;
  stop(): void;
}

export interface ProaApp {
  readonly engineName: string;
  tabs: {
    open(url?: string): Promise<Tab>;
    list(): Promise<Tab[]>;
  };
  agents: {
    run(task: string, opts?: RunOptions): AgentRun;
  };
  ledger(domain?: string, space?: string): Promise<LedgerEntry[]>;
  close(): Promise<void>;
}

class LocalTab implements Tab {
  constructor(private readonly inner: EngineTab) {}
  get id() {
    return this.inner.id;
  }
  goto(url: string) {
    return this.inner.navigate(url);
  }
  ir() {
    return this.inner.snapshot();
  }
  async extract<T>(schema: z.ZodType<T>): Promise<T> {
    const ir = await this.inner.snapshot();
    const spec = zodToSchemaSpec(schema as z.ZodTypeAny);
    const { value } = mapSchema(ir, spec);
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : (value as T);
  }
  async screenshot(opts?: { fullPage?: boolean }) {
    const s = await this.inner.screenshot(opts);
    return { ref: s.ref };
  }
  close() {
    return this.inner.close();
  }
}

class LocalAgentRun implements AgentRun {
  private queue: AgentStep[] = [];
  private waiters: ((r: IteratorResult<AgentStep>) => void)[] = [];
  private finished = false;
  private controller = new AbortController();
  private outcome: Promise<RunOutcome>;
  private writer: TraceWriter;

  constructor(
    engine: Engine,
    provider: ModelProvider,
    permissions: PermissionEngine,
    task: string,
    opts: RunOptions,
  ) {
    this.writer = new TraceWriter({
      traceId: newTraceId(),
      task,
      provider: provider.name,
      engine: engine.name,
      createdAt: new Date().toISOString(),
    });
    this.outcome = runAgent({
      engine,
      provider,
      task,
      permissions,
      trace: this.writer,
      budget: opts.budget,
      tools: opts.tools,
      space: opts.space,
      agentId: opts.agentId,
      startUrl: opts.startUrl,
      signal: this.controller.signal,
      onStep: (s) => this.push(s),
    }).finally(() => this.end());
  }

  private push(step: AgentStep) {
    const w = this.waiters.shift();
    if (w) w({ value: step, done: false });
    else this.queue.push(step);
  }

  private end() {
    this.finished = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true });
  }

  private nextStep = (): Promise<IteratorResult<AgentStep>> => {
    if (this.queue.length) return Promise.resolve({ value: this.queue.shift()!, done: false });
    if (this.finished) return Promise.resolve({ value: undefined as never, done: true });
    return new Promise((resolve) => this.waiters.push(resolve));
  };

  steps(): AsyncIterable<AgentStep> {
    const next = this.nextStep;
    return {
      [Symbol.asyncIterator]: () => ({ next }),
    };
  }

  result() {
    return this.outcome;
  }

  trace(): ParsedTrace {
    return { meta: this.writer.meta, events: [...this.writer.events()] };
  }

  stop() {
    this.controller.abort();
  }
}

export interface LaunchOptions {
  headless?: boolean;
  /** Deterministic route resolver (fixtures/tests). */
  resolve?: Resolver;
  baseUrl?: string;
  /** Default provider for agents.run when none is passed and no API key is set. */
  provider?: ModelProvider;
}

class LocalApp implements ProaApp {
  private tabsById: LocalTab[] = [];
  constructor(
    private readonly engine: Engine,
    private readonly opts: LaunchOptions,
  ) {}

  get engineName() {
    return this.engine.name;
  }

  tabs = {
    open: async (url?: string): Promise<Tab> => {
      const t = new LocalTab(await this.engine.openTab(url));
      this.tabsById.push(t);
      return t;
    },
    list: async (): Promise<Tab[]> => {
      return this.tabsById;
    },
  };

  agents = {
    run: (task: string, opts: RunOptions = {}): AgentRun => {
      const provider = opts.provider ?? this.opts.provider ?? defaultProvider();
      const permissions = resolvePermissions(opts.permissions);
      this.lastPermissions = permissions;
      return new LocalAgentRun(this.engine, provider, permissions, task, opts);
    },
  };

  private lastPermissions?: PermissionEngine;

  async ledger(domain?: string, space?: string): Promise<LedgerEntry[]> {
    if (!this.lastPermissions) return [];
    return domain ? this.lastPermissions.ledgerFor(domain, space) : this.lastPermissions.store.list();
  }

  close() {
    return this.engine.close();
  }
}

function resolvePermissions(p: RunOptions["permissions"]): PermissionEngine {
  if (!p) return new PermissionEngine();
  if (isPermissionEngine(p)) return p;
  return engineFromSpec(p as PermissionsSpec);
}

function defaultProvider(): ModelProvider {
  if (process.env.ANTHROPIC_API_KEY) return new AnthropicProvider();
  // No key: a no-op provider that immediately finishes with guidance. Pass a real
  // provider (or MockProvider) via opts.provider for agent runs without a key.
  return new MockProvider([
    {
      thought: "no model configured",
      action: {
        tool: "done",
        params: { summary: "No model provider configured. Set ANTHROPIC_API_KEY or pass opts.provider." },
      },
    },
  ]);
}

/** Launch a headless Proa (jsdom engine). Same core, extractor, and permission model as the app. */
export async function launch(opts: LaunchOptions = {}): Promise<ProaApp> {
  const engine = new DomEngine({ resolve: opts.resolve, baseUrl: opts.baseUrl });
  return new LocalApp(engine, opts);
}
