import type { Engine, EngineTab, RunOutcome, SchemaSpec, ToolName } from "@proa/protocol";
import { DEFAULT_BUDGET } from "@proa/protocol";
import {
  DomEngine,
  MockProvider,
  AnthropicProvider,
  mapSchema,
  runAgent,
  newTraceId,
  type Resolver,
} from "@proa/core";
import { PermissionEngine, allowReversibleOnly, domainOf } from "@proa/permissions";
import { TraceWriter, type ParsedTrace } from "@proa/traces";

export interface SessionOptions {
  /** Inject a deterministic resolver (fixtures/tests). Omit for the real web (fetch). */
  resolve?: Resolver;
  baseUrl?: string;
  engine?: Engine;
  permissions?: PermissionEngine;
  /** Directory to persist traces (optional). */
}

export interface CallResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/**
 * The engine-backed session shared by the MCP protocol server and the HTTP bridge. It owns
 * a set of tabs, routes tool calls to the engine, and enforces the permission engine on
 * every write — so an external agent driving Proa gets the same guarantees as the in-app one.
 */
export class ProaSession {
  private engine: Engine;
  private permissions: PermissionEngine;
  private tabs = new Map<string, EngineTab>();
  private currentTabId?: string;
  private abort?: AbortController;
  readonly space = "mcp";
  readonly agentId = "mcp-client";

  constructor(private readonly opts: SessionOptions = {}) {
    this.engine = opts.engine ?? new DomEngine({ resolve: opts.resolve, baseUrl: opts.baseUrl });
    this.permissions = opts.permissions ?? new PermissionEngine({ prompter: allowReversibleOnly });
  }

  private async tab(tabId?: string): Promise<EngineTab> {
    const id = tabId ?? this.currentTabId;
    if (id) {
      const t = this.tabs.get(id) ?? (await this.engine.getTab(id));
      if (t) return t;
    }
    // Lazily open a tab if none exists.
    const t = await this.engine.openTab();
    this.tabs.set(t.id, t);
    this.currentTabId = t.id;
    return t;
  }

  private async gate(tab: EngineTab, action: { tool: ToolName; params: Record<string, unknown> }) {
    const ir = await tab.snapshot();
    const domain = domainOf((await tab.getState()).url);
    return this.permissions.check({ agent: this.agentId, space: this.space, domain, action, ir });
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<CallResult> {
    try {
      const result = await this.dispatch(name, args);
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private async dispatch(name: string, a: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "ping":
        return { pong: true, engine: this.engine.name };
      case "tabs.open": {
        const t = await this.engine.openTab(a.url ? String(a.url) : undefined);
        this.tabs.set(t.id, t);
        this.currentTabId = t.id;
        return { tabId: t.id };
      }
      case "tabs.close": {
        const t = await this.engine.getTab(String(a.tabId));
        await t?.close();
        this.tabs.delete(String(a.tabId));
        return { closed: true };
      }
      case "tabs.list":
        return (await this.engine.listTabs()).map((t) => t.id);
      case "navigate": {
        const t = await this.tab(a.tabId as string);
        await t.navigate(String(a.url));
        return { url: (await t.getState()).url };
      }
      case "ir": {
        const t = await this.tab(a.tabId as string);
        return await t.snapshot();
      }
      case "click": {
        const t = await this.tab(a.tabId as string);
        const d = await this.gate(t, { tool: "click", params: { ref: a.ref } });
        if (!d.allowed) throw new Error(`permission-denied (${d.capability}${d.irreversible ? "/" + d.irreversible : ""}): ${d.reason}`);
        await t.click(String(a.ref));
        return { ok: true };
      }
      case "type": {
        const t = await this.tab(a.tabId as string);
        const d = await this.gate(t, { tool: "type", params: { ref: a.ref, text: a.text, submit: a.submit } });
        if (!d.allowed) throw new Error(`permission-denied (${d.capability}): ${d.reason}`);
        await t.type(String(a.ref), String(a.text ?? ""), { submit: a.submit === true });
        return { ok: true };
      }
      case "select": {
        const t = await this.tab(a.tabId as string);
        const d = await this.gate(t, { tool: "select", params: { ref: a.ref, value: a.value } });
        if (!d.allowed) throw new Error(`permission-denied (${d.capability}): ${d.reason}`);
        await t.select(String(a.ref), String(a.value ?? ""));
        return { ok: true };
      }
      case "scroll": {
        const t = await this.tab(a.tabId as string);
        await t.scroll({ direction: (a.direction as "down") ?? "down", amount: a.amount as number });
        return { ok: true };
      }
      case "waitFor": {
        const t = await this.tab(a.tabId as string);
        return { met: await t.waitFor({ ref: a.ref as string, text: a.text as string, timeoutMs: a.timeoutMs as number }) };
      }
      case "extract": {
        const t = await this.tab(a.tabId as string);
        const ir = await t.snapshot();
        const { value, confidence } = mapSchema(ir, a.schema as SchemaSpec);
        return { value, confidence };
      }
      case "screenshot": {
        const t = await this.tab(a.tabId as string);
        return await t.screenshot({ fullPage: a.fullPage === true });
      }
      case "download":
        return { quarantined: true, note: "download gated pending grant" };
      case "ledger": {
        const domain = a.domain as string | undefined;
        return domain ? this.permissions.ledgerFor(domain, a.space as string) : this.permissions.store.list();
      }
      case "agent.run":
        return await this.runAgentTask(a);
      case "agent.stop":
        this.abort?.abort();
        return { stopped: true };
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  }

  private async runAgentTask(a: Record<string, unknown>): Promise<{ outcome: RunOutcome; trace: ParsedTrace }> {
    const provider = process.env.ANTHROPIC_API_KEY
      ? new AnthropicProvider()
      : new MockProvider([
          { thought: "no model configured for MCP agent.run", action: { tool: "done", params: { summary: "Set ANTHROPIC_API_KEY to enable agent.run over MCP." } } },
        ]);
    const trace = new TraceWriter({
      traceId: newTraceId(),
      task: String(a.task),
      provider: provider.name,
      engine: this.engine.name,
      createdAt: new Date().toISOString(),
    });
    this.abort = new AbortController();
    const outcome = await runAgent({
      engine: this.engine,
      provider,
      task: String(a.task),
      permissions: this.permissions,
      trace,
      budget: { ...DEFAULT_BUDGET, maxSteps: (a.maxSteps as number) ?? DEFAULT_BUDGET.maxSteps },
      space: this.space,
      agentId: this.agentId,
      startUrl: a.startUrl as string | undefined,
      signal: this.abort.signal,
    });
    return { outcome, trace: { meta: trace.meta, events: [...trace.events()] } };
  }

  async close(): Promise<void> {
    await this.engine.close();
  }
}
