import { join } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { app, BrowserWindow, ipcMain, type Rectangle } from "electron";
import { PermissionEngine, type Prompter } from "@proa/permissions";
import { runAgent, newTraceId } from "@proa/core";
import { AnthropicProvider, MockProvider } from "@proa/core";
import { TraceWriter, FileTraceStore, toPlaywrightTest } from "@proa/traces";
import { ProaSession, serveBridge } from "@proa/mcp";
import type { AgentStep } from "@proa/protocol";
import { ChromiumEngine } from "./engine.js";
import { AppState } from "./state.js";
import type { AgentUpdate, PermissionPrompt, SpaceInfo, TabInfo } from "../shared/types.js";

const SIDEBAR_W = 280;
const CONSOLE_W = 380;
const TOPBAR_H = 52;
const CARD_INSET = 14;

const GRADIENTS = [
  "linear-gradient(135deg,#e9d5ff 0%,#fde2c8 100%)", // signature lavender→peach
  "linear-gradient(135deg,#cffafe 0%,#a5b4fc 100%)",
  "linear-gradient(135deg,#bbf7d0 0%,#bfdbfe 100%)",
  "linear-gradient(135deg,#fbcfe8 0%,#fed7aa 100%)",
  "linear-gradient(135deg,#1e293b 0%,#0f172a 100%)",
];

interface SpaceRuntime {
  info: SpaceInfo;
  engine: ChromiumEngine;
  tabMeta: Map<string, { agentOwned: boolean }>;
  activeTabId: string | null;
}

class Proa {
  private win!: BrowserWindow;
  private state!: AppState;
  private permissions!: PermissionEngine;
  private spaces = new Map<string, SpaceRuntime>();
  private activeSpaceId = "";
  private consoleOpen = true;
  private overlayOpen = false;
  private pendingPrompts = new Map<string, (allow: boolean) => void>();
  private runs = new Map<string, AbortController>();
  private traceStore!: FileTraceStore;
  private mcp: { url: string | null; token: string | null } = { url: null, token: null };

  async start(): Promise<void> {
    this.state = new AppState(app.getPath("userData"));
    this.traceStore = new FileTraceStore(join(app.getPath("userData"), "traces"));
    this.permissions = new PermissionEngine({ store: this.state, prompter: this.makePrompter() });

    this.win = new BrowserWindow({
      width: 1360,
      height: 900,
      minWidth: 980,
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
      backgroundColor: "#0b1020",
      webPreferences: {
        preload: join(__dirname, "../preload/index.mjs"),
        sandbox: true,
        contextIsolation: true,
      },
    });

    // Restore or seed Spaces.
    const existing = this.state.listSpaces();
    if (existing.length === 0) {
      this.seedSpace("Personal", GRADIENTS[0]!);
    } else {
      for (const s of existing) this.attachSpace(s);
    }
    this.activeSpaceId = [...this.spaces.keys()][0]!;

    this.registerIpc();
    this.win.on("resize", () => this.layout());

    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    if (rendererUrl) await this.win.loadURL(rendererUrl);
    else await this.win.loadFile(join(__dirname, "../renderer/index.html"));

    this.layout();
    await this.startMcpBridge();
  }

  private seedSpace(name: string, gradient: string): SpaceInfo {
    const id = randomUUID().slice(0, 8);
    const info: SpaceInfo = { id, name, gradient, partition: `persist:proa-${id}` };
    this.state.addSpace(info);
    this.attachSpace(info);
    return info;
  }

  private attachSpace(info: SpaceInfo): void {
    const engine = new ChromiumEngine(this.win, info.partition, () => this.webBounds());
    this.spaces.set(info.id, { info, engine, tabMeta: new Map(), activeTabId: null });
  }

  private active(): SpaceRuntime {
    return this.spaces.get(this.activeSpaceId)!;
  }

  private webBounds(): Rectangle {
    const b = this.win.getContentBounds();
    const right = this.consoleOpen ? CONSOLE_W : 0;
    return {
      x: SIDEBAR_W + CARD_INSET,
      y: TOPBAR_H + CARD_INSET,
      width: Math.max(200, b.width - SIDEBAR_W - right - CARD_INSET * 2),
      height: Math.max(200, b.height - TOPBAR_H - CARD_INSET * 2),
    };
  }

  private layout(): void {
    const rt = this.active();
    rt.engine.setBounds(this.webBounds());
    if (this.overlayOpen) rt.engine.hideAll();
    else rt.engine.setActive(rt.activeTabId);
  }

  private makePrompter(): Prompter {
    return (req) =>
      new Promise<boolean>((resolve) => {
        const id = randomUUID().slice(0, 8);
        this.pendingPrompts.set(id, resolve);
        const prompt: PermissionPrompt = {
          id,
          agent: req.agent,
          domain: req.domain,
          space: req.space,
          capability: req.capability,
          irreversible: req.irreversible,
          target: req.target,
          reason: req.reason,
        };
        this.emit("*", { kind: "permission", permission: prompt });
        // Irreversible prompts auto-deny after 45s of no answer (safe default).
        setTimeout(() => {
          if (this.pendingPrompts.has(id)) {
            this.pendingPrompts.delete(id);
            resolve(false);
          }
        }, 45_000);
      });
  }

  private emit(runId: string, update: AgentUpdate): void {
    if (!this.win.isDestroyed()) this.win.webContents.send("agent:update", runId, update);
  }

  private notifyTabs(): void {
    if (!this.win.isDestroyed()) this.win.webContents.send("tabs:changed");
  }

  private async startMcpBridge(): Promise<void> {
    try {
      const token = randomBytes(16).toString("hex");
      const session = new ProaSession({ engine: this.active().engine, permissions: this.permissions });
      const { port } = await serveBridge(session, { port: 8787, token });
      this.mcp = { url: `http://127.0.0.1:${port}`, token };
    } catch {
      this.mcp = { url: null, token: null };
    }
  }

  private registerIpc(): void {
    const h = ipcMain.handle.bind(ipcMain);

    h("spaces:list", async () => [...this.spaces.values()].map((s) => s.info));
    h("spaces:create", async (_e, name: string) => {
      const info = this.seedSpace(name, GRADIENTS[this.spaces.size % GRADIENTS.length]!);
      return info;
    });
    h("spaces:switch", async (_e, id: string) => {
      if (!this.spaces.has(id)) return;
      this.active().engine.hideAll();
      this.activeSpaceId = id;
      this.layout();
    });

    h("tabs:list", async (_e, spaceId: string) => {
      const rt = this.spaces.get(spaceId);
      if (!rt) return [];
      const out: TabInfo[] = [];
      for (const t of await rt.engine.listTabs()) {
        const st = await t.getState();
        out.push({
          id: t.id,
          title: st.title || st.url,
          url: st.url,
          spaceId,
          loading: false,
          agentOwned: rt.tabMeta.get(t.id)?.agentOwned ?? false,
          canGoBack: st.canGoBack,
          canGoForward: st.canGoForward,
        });
      }
      return out;
    });
    h("tabs:open", async (_e, spaceId: string, url?: string) => {
      const rt = this.spaces.get(spaceId) ?? this.active();
      const tab = await rt.engine.openTab(url ?? "https://proa.dev/start");
      rt.tabMeta.set(tab.id, { agentOwned: false });
      rt.activeTabId = tab.id;
      this.layout();
      this.notifyTabs();
      const st = await tab.getState();
      this.state.addHistory(st.url, st.title, spaceId);
      return { id: tab.id, title: st.title, url: st.url, spaceId, loading: false, agentOwned: false, canGoBack: st.canGoBack, canGoForward: st.canGoForward } satisfies TabInfo;
    });
    h("tabs:close", async (_e, tabId: string) => {
      const rt = this.active();
      const tab = rt.engine.chromiumTab(tabId);
      await tab?.close();
      rt.tabMeta.delete(tabId);
      if (rt.activeTabId === tabId) rt.activeTabId = null;
      this.notifyTabs();
    });
    h("tabs:activate", async (_e, tabId: string) => {
      this.active().activeTabId = tabId;
      this.layout();
      this.notifyTabs();
    });
    h("tabs:navigate", async (_e, tabId: string, url: string) => {
      const tab = this.active().engine.chromiumTab(tabId);
      await tab?.navigate(url);
      if (tab) {
        const st = await tab.getState();
        this.state.addHistory(st.url, st.title, this.activeSpaceId);
      }
      this.notifyTabs();
    });
    h("tabs:back", async (_e, tabId: string) => {
      await this.active().engine.chromiumTab(tabId)?.goBack();
      this.notifyTabs();
    });
    h("tabs:forward", async (_e, tabId: string) => {
      await this.active().engine.chromiumTab(tabId)?.goForward();
      this.notifyTabs();
    });

    h("history:search", async (_e, query: string) => this.state.searchHistory(query));

    h("page:ir", async (_e, tabId: string) => {
      const tab = this.active().engine.chromiumTab(tabId);
      return tab ? await tab.snapshot() : null;
    });
    h("page:json", async (_e, tabId: string) => {
      const tab = this.active().engine.chromiumTab(tabId);
      return tab ? JSON.stringify(await tab.snapshot(), null, 2) : "{}";
    });
    h("page:playwright", async (_e, tabId: string) => {
      const tab = this.active().engine.chromiumTab(tabId);
      if (!tab) return "";
      const ir = await tab.snapshot();
      const writer = new TraceWriter({ traceId: "hud", task: "HUD capture", provider: "none", engine: "chromium", createdAt: new Date().toISOString() });
      writer.append("ir.snapshot", ir);
      return toPlaywrightTest({ meta: writer.meta, events: [...writer.events()] });
    });
    h("page:network", async (_e, tabId: string) => {
      const tab = this.active().engine.chromiumTab(tabId);
      return tab ? await tab.networkSummary() : { requests: 0, failed: 0, bytes: 0, domains: [] };
    });
    h("page:cdp", async (_e, _tabId: string) => `ws://127.0.0.1 (per-tab debugger attached; use @proa/mcp to drive)`);

    h("ledger:read", async (_e, domain?: string, space?: string) =>
      domain ? this.permissions.ledgerFor(domain, space) : this.state.list(),
    );

    h("agent:run", async (_e, input: { task: string; spaceId: string; startUrl?: string; maxSteps?: number }) =>
      this.runAgentTask(input),
    );
    h("agent:stop", async (_e, runId: string) => {
      this.runs.get(runId)?.abort();
    });
    h("permission:respond", async (_e, promptId: string, allow: boolean) => {
      const resolve = this.pendingPrompts.get(promptId);
      if (resolve) {
        this.pendingPrompts.delete(promptId);
        resolve(allow);
      }
    });
    h("overlay:set", async (_e, open: boolean) => {
      this.overlayOpen = open;
      this.layout();
    });
    h("console:set", async (_e, open: boolean) => {
      this.consoleOpen = open;
      this.layout();
    });
    h("mcp:info", async () => this.mcp);
  }

  private async runAgentTask(input: { task: string; spaceId: string; startUrl?: string; maxSteps?: number }): Promise<{ runId: string }> {
    const rt = this.spaces.get(input.spaceId) ?? this.active();
    const runId = randomUUID().slice(0, 8);
    const controller = new AbortController();
    this.runs.set(runId, controller);

    const provider = process.env.ANTHROPIC_API_KEY
      ? new AnthropicProvider()
      : new MockProvider([{ thought: "no model configured", action: { tool: "done", params: { summary: "Set ANTHROPIC_API_KEY to run live agents." } } }]);

    const trace = new TraceWriter({
      traceId: newTraceId(),
      task: input.task,
      provider: provider.name,
      engine: rt.engine.name,
      createdAt: new Date().toISOString(),
    });

    void (async () => {
      const onStep = async (step: AgentStep) => {
        this.emit(runId, { kind: "step", step });
        const ref = typeof step.action.params.ref === "string" ? step.action.params.ref : undefined;
        if (ref && rt.activeTabId) {
          const pos = await rt.engine.chromiumTab(rt.activeTabId)?.rectOf(ref).catch(() => null);
          if (pos) this.emit(runId, { kind: "ghost", ghost: { x: pos.x, y: pos.y, label: step.action.tool } });
        }
      };
      const outcome = await runAgent({
        engine: rt.engine,
        provider,
        task: input.task,
        permissions: this.permissions,
        trace,
        budget: { maxSteps: input.maxSteps ?? 40 },
        space: rt.info.id,
        agentId: `agent:${runId}`,
        startUrl: input.startUrl,
        signal: controller.signal,
        onStep: (s) => void onStep(s),
        onThought: (t) => this.emit(runId, { kind: "thought", thought: t }),
      });
      // Persist + index the trace.
      const store = this.traceStore.create(trace.meta);
      for (const e of trace.events()) store.append(e.type, e.payload);
      this.state.indexTrace({ ...trace.meta, path: `${trace.meta.traceId}.jsonl` });
      this.emit(runId, { kind: "outcome", outcome });
      this.runs.delete(runId);
      this.notifyTabs();
    })();

    return { runId };
  }
}

app.whenReady().then(() => {
  const proa = new Proa();
  void proa.start();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void proa.start();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
