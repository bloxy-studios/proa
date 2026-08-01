import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AgentStep, PageIR } from "@proa/protocol";
import type { AgentUpdate, PermissionPrompt, SpaceInfo, TabInfo } from "../shared/types.js";

const proa = () => window.proa;

export function App(): React.JSX.Element {
  const [spaces, setSpaces] = useState<SpaceInfo[]>([]);
  const [activeSpace, setActiveSpace] = useState<string>("");
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [activeTab, setActiveTab] = useState<string>("");
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [hud, setHud] = useState<PageIR | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [thought, setThought] = useState<string>("");
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string } | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<PermissionPrompt | null>(null);
  const [ledgerCount, setLedgerCount] = useState(0);

  const space = spaces.find((s) => s.id === activeSpace);
  const current = tabs.find((t) => t.id === activeTab);

  const refreshTabs = useCallback(async (sid: string) => {
    const list = await proa().listTabs(sid);
    setTabs(list);
    if (list.length && !list.some((t) => t.id === activeTab)) setActiveTab(list[0]!.id);
  }, [activeTab]);

  useEffect(() => {
    void (async () => {
      const s = await proa().listSpaces();
      setSpaces(s);
      if (s[0]) {
        setActiveSpace(s[0].id);
        await refreshTabs(s[0].id);
      }
    })();
    const offTabs = proa().onTabsChanged(() => void (activeSpace && refreshTabs(activeSpace)));
    const offAgent = proa().onAgentUpdate((_runId, u: AgentUpdate) => {
      if (u.kind === "thought" && u.thought) setThought(u.thought);
      if (u.kind === "step" && u.step) setSteps((p) => [...p, u.step!]);
      if (u.kind === "ghost" && u.ghost) setGhost(u.ghost);
      if (u.kind === "permission" && u.permission) setPrompt(u.permission);
      if (u.kind === "outcome") {
        setRunning(null);
        setGhost(null);
        void proa().ledger().then((l) => setLedgerCount(l.length));
      }
    });
    return () => { offTabs(); offAgent(); };
  }, []);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { void window.proaChrome.setOverlay(paletteOpen || !!hud); }, [paletteOpen, hud]);
  useEffect(() => { void window.proaChrome.setConsole(consoleOpen); }, [consoleOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    let lastEsc = 0;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "t") { e.preventDefault(); setPaletteOpen(true); }
      else if (meta && e.key === "l") { e.preventDefault(); setPaletteOpen(true); }
      else if (meta && e.shiftKey && (e.key === "D" || e.key === "d")) { e.preventDefault(); void openHud(); }
      else if (meta && e.key === "w") { e.preventDefault(); if (activeTab) void proa().closeTab(activeTab); }
      else if (e.key === "Escape") {
        const now = Date.now();
        if (paletteOpen) setPaletteOpen(false);
        else if (hud) setHud(null);
        else if (now - lastEsc < 400 && running) { void proa().stopAgent(running); setRunning(null); }
        lastEsc = now;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTab, paletteOpen, hud, running]);

  const openHud = async () => { if (activeTab) setHud(await proa().pageIR(activeTab)); };

  const openTab = async (url?: string) => {
    if (!activeSpace) return;
    const t = await proa().openTab(activeSpace, url);
    setActiveTab(t.id);
    await refreshTabs(activeSpace);
  };
  const switchSpace = async (id: string) => {
    await proa().switchSpace(id);
    setActiveSpace(id);
    await refreshTabs(id);
  };

  const runAgent = async (task: string) => {
    setSteps([]); setThought(""); setGhost(null);
    const { runId } = await proa().runAgent({ task, spaceId: activeSpace, startUrl: current?.url, maxSteps: 40 });
    setRunning(runId);
  };

  return (
    <div className={`shell${consoleOpen ? " console-open" : ""}`}>
      <Sidebar
        space={space} spaces={spaces} tabs={tabs} activeTab={activeTab} ledgerCount={ledgerCount}
        onSwitchSpace={switchSpace}
        onNewSpace={async () => { const s = await proa().createSpace(`Space ${spaces.length + 1}`); setSpaces(await proa().listSpaces()); void switchSpace(s.id); }}
        onActivate={async (id) => { setActiveTab(id); await proa().activateTab(id); }}
        onClose={async (id) => { await proa().closeTab(id); await refreshTabs(activeSpace); }}
        onNewTab={() => setPaletteOpen(true)}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        onToggleConsole={() => setConsoleOpen((v) => !v)}
      />

      <WebArea space={space} current={current} ghost={ghost}
        onBack={() => activeTab && proa().goBack(activeTab)}
        onForward={() => activeTab && proa().goForward(activeTab)}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenHud={openHud}
      />

      {consoleOpen && (
        <AgentConsole steps={steps} thought={thought} running={running}
          onRun={runAgent} onStop={() => { if (running) { void proa().stopAgent(running); setRunning(null); } }} />
      )}

      {paletteOpen && (
        <CommandPalette
          initial={current?.url ?? ""}
          tabs={tabs}
          onClose={() => setPaletteOpen(false)}
          onOpenUrl={(u) => { setPaletteOpen(false); void openTab(u); }}
          onSwitchTab={(id) => { setPaletteOpen(false); setActiveTab(id); void proa().activateTab(id); }}
          onRunAgent={(task) => { setPaletteOpen(false); void runAgent(task); }}
        />
      )}

      {hud && <DevHud ir={hud} tabId={activeTab} onClose={() => setHud(null)} />}

      {prompt && (
        <PermissionToast prompt={prompt}
          onRespond={(allow) => { void proa().respondPermission(prompt.id, allow); setPrompt(null); }} />
      )}
    </div>
  );
}

// ---- Sidebar ----------------------------------------------------------------

function Sidebar(props: {
  space?: SpaceInfo; spaces: SpaceInfo[]; tabs: TabInfo[]; activeTab: string; ledgerCount: number;
  onSwitchSpace(id: string): void; onNewSpace(): void; onActivate(id: string): void; onClose(id: string): void;
  onNewTab(): void; onToggleTheme(): void; onToggleConsole(): void;
}): React.JSX.Element {
  const { space, current } = { space: props.space, current: props.tabs.find((t) => t.id === props.activeTab) };
  return (
    <aside className="sidebar">
      <div className="space-switcher">
        <span className="space-dot" style={{ background: "var(--accent)" }} />
        <span className="space-name">{space?.name ?? "Proa"}</span>
      </div>
      <div className="space-list">
        {props.spaces.map((s) => (
          <button key={s.id} className={`space-chip${s.id === space?.id ? " active" : ""}`} onClick={() => props.onSwitchSpace(s.id)}>{s.name}</button>
        ))}
        <button className="space-chip" onClick={props.onNewSpace}>+ Space</button>
      </div>
      <div className="url-pill" onClick={props.onNewTab}>
        <span>🔍</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current?.url || "Search or enter address"}</span>
        <span className="ledger" title="Agent actions recorded on this site">⛨ {props.ledgerCount}</span>
      </div>
      <div className="pinned">
        {["◆", "✦", "❖", "✷"].map((g, i) => <div key={i} className="fav">{g}</div>)}
      </div>
      <div className="section-label">Tabs</div>
      <div className="tablist">
        {props.tabs.length === 0 && <div className="empty">No tabs. ⌘T to open one.</div>}
        {props.tabs.map((t) => (
          <div key={t.id} className={`tab${t.id === props.activeTab ? " active" : ""}${t.agentOwned ? " agent" : ""}`} onClick={() => props.onActivate(t.id)}>
            <span className="dot" style={t.agentOwned ? { background: "var(--agent)" } : undefined} />
            <span className="title">{t.title || t.url || "New tab"}</span>
            <button className="close" onClick={(e) => { e.stopPropagation(); props.onClose(t.id); }}>✕</button>
          </div>
        ))}
      </div>
      <button className="tab" onClick={props.onNewTab}>＋ New tab</button>
      <div className="utility">
        <button onClick={props.onToggleTheme} title="Toggle theme">◐</button>
        <button onClick={props.onToggleConsole} title="Toggle agent console">◨</button>
        <span className="grow" />
        <span title="Local-first. Zero telemetry.">● local</span>
      </div>
    </aside>
  );
}

// ---- Web area ---------------------------------------------------------------

function WebArea(props: {
  space?: SpaceInfo; current?: TabInfo; ghost: { x: number; y: number; label: string } | null;
  onBack(): void; onForward(): void; onOpenPalette(): void; onOpenHud(): void;
}): React.JSX.Element {
  return (
    <section className="web">
      <div className="wallpaper" style={{ background: props.space?.gradient ?? "var(--bg)" }} />
      <div className="topbar">
        <button className="navbtn" onClick={props.onBack} disabled={!props.current?.canGoBack}>‹</button>
        <button className="navbtn" onClick={props.onForward} disabled={!props.current?.canGoForward}>›</button>
        <button className="navbtn" onClick={props.onOpenPalette}>⌘T</button>
        <span style={{ flex: 1 }} />
        <button className="navbtn" onClick={props.onOpenHud} title="Developer HUD (⌘⇧D)">{"</>"}</button>
      </div>
      <div className="web-card">
        {props.current ? `Live web content renders here — ${props.current.url}` : "Open a tab (⌘T) to start browsing."}
        {props.ghost && (
          <div className="ghost" style={{ left: `${props.ghost.x * 100}%`, top: `${props.ghost.y * 100}%` }}>
            <div className="dot" />
            <div className="lbl">{props.ghost.label}</div>
          </div>
        )}
      </div>
    </section>
  );
}

// ---- Agent console ----------------------------------------------------------

function AgentConsole(props: {
  steps: AgentStep[]; thought: string; running: string | null;
  onRun(task: string): void; onStop(): void;
}): React.JSX.Element {
  const [task, setTask] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => { feedRef.current?.scrollTo(0, feedRef.current.scrollHeight); }, [props.steps, props.thought]);
  return (
    <aside className="console">
      <h3>Agent</h3>
      <div className="feed" ref={feedRef}>
        {props.steps.length === 0 && !props.running && (
          <div className="empty">Give the agent a task. Watch it work with a ghost cursor — pause, take over, or grant as it goes.</div>
        )}
        {props.steps.map((s) => (
          <div className="step" key={s.index}>
            <div className="thought">{s.thought}</div>
            <div className="action">{s.action.tool}({shortParams(s.action.params)})</div>
            {s.result && (
              <div className={`result ${s.result.ok ? "ok" : "blocked"}`}>
                {s.result.ok ? "✓ " : "⛔ "}{s.result.summary}
              </div>
            )}
            {(s.result?.data !== undefined) && (
              <div className="artifact"><pre>{JSON.stringify(s.result.data, null, 2).slice(0, 600)}</pre></div>
            )}
          </div>
        ))}
        {props.running && <div className="step"><div className="thought">{props.thought || "thinking…"}</div></div>}
      </div>
      <div className="composer">
        <textarea placeholder="Ask the agent to do something…" value={task} onChange={(e) => setTask(e.target.value)} />
        <div className="row">
          {props.running ? (
            <button className="btn stop" onClick={props.onStop}>■ Stop (Esc Esc)</button>
          ) : (
            <button className="btn" onClick={() => { if (task.trim()) props.onRun(task.trim()); }}>Run ▸</button>
          )}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{props.running ? "running" : "idle"}</span>
        </div>
      </div>
    </aside>
  );
}

// ---- Command palette --------------------------------------------------------

function CommandPalette(props: {
  initial: string; tabs: TabInfo[];
  onClose(): void; onOpenUrl(u: string): void; onSwitchTab(id: string): void; onRunAgent(task: string): void;
}): React.JSX.Element {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const results = buildResults(q, props.tabs);
  const commit = (i: number) => {
    const r = results[i];
    if (!r) { if (q.trim()) props.onOpenUrl(normalizeUrl(q)); return; }
    if (r.kind === "tab") props.onSwitchTab(r.value);
    else if (r.kind === "agent") props.onRunAgent(r.value);
    else props.onOpenUrl(r.value);
  };

  return (
    <div className="overlay" onClick={props.onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input ref={inputRef} value={q} placeholder="Search, enter a URL, / for commands, @ for agent tasks"
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setSel((s) => Math.min(s + 1, results.length - 1));
            else if (e.key === "ArrowUp") setSel((s) => Math.max(s - 1, 0));
            else if (e.key === "Enter") commit(sel);
            else if (e.key === "Escape") props.onClose();
          }} />
        <div className="hint">URL · search · tab-switch · / commands · @ agent</div>
        <div className="results">
          {results.map((r, i) => (
            <div key={i} className={`res${i === sel ? " sel" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => commit(i)}>
              <span>{r.icon}</span><span>{r.label}</span><span className="kind">{r.kind}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface Res { kind: "url" | "search" | "tab" | "agent" | "command"; icon: string; label: string; value: string; }
function buildResults(q: string, tabs: TabInfo[]): Res[] {
  const out: Res[] = [];
  if (!q.trim()) return tabs.slice(0, 6).map((t) => ({ kind: "tab", icon: "▤", label: t.title || t.url, value: t.id }));
  if (q.startsWith("@")) return [{ kind: "agent", icon: "✦", label: `Run agent: ${q.slice(1).trim()}`, value: q.slice(1).trim() }];
  if (q.startsWith("/")) return [{ kind: "command", icon: "⚙", label: `Command: ${q.slice(1)}`, value: q.slice(1) }];
  if (looksLikeUrl(q)) out.push({ kind: "url", icon: "🌐", label: `Open ${q}`, value: normalizeUrl(q) });
  for (const t of tabs) if ((t.title + t.url).toLowerCase().includes(q.toLowerCase())) out.push({ kind: "tab", icon: "▤", label: t.title || t.url, value: t.id });
  out.push({ kind: "search", icon: "🔍", label: `Search the web for “${q}”`, value: `https://duckduckgo.com/?q=${encodeURIComponent(q)}` });
  return out;
}
function looksLikeUrl(q: string): boolean { return /^[\w-]+(\.[\w-]+)+/.test(q.trim()) && !q.includes(" "); }
function normalizeUrl(q: string): string { return /^https?:\/\//.test(q) ? q : `https://${q.trim()}`; }

// ---- Dev HUD ----------------------------------------------------------------

function DevHud(props: { ir: PageIR; tabId: string; onClose(): void }): React.JSX.Element {
  const [tab, setTab] = useState<"ir" | "json">("ir");
  const [copied, setCopied] = useState("");
  const doCopy = async (kind: "json" | "pw") => {
    const text = kind === "json" ? await window.proa.copyPageAsJSON(props.tabId) : await window.proa.copyAsPlaywright(props.tabId);
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(kind === "json" ? "Copied page as JSON" : "Copied as Playwright");
    setTimeout(() => setCopied(""), 1600);
  };
  return (
    <div className="hud">
      <div className="hud-head">
        <b>{"</> Developer HUD"}</b>
        {props.ir.tainted && <span className="tag tainted">⚠ tainted content</span>}
        <span style={{ flex: 1 }} />
        <button onClick={props.onClose}>✕</button>
      </div>
      <div className="hud-stats">
        <span>nodes <b>{props.ir.nodeCount}</b></span>
        <span>title <b>{props.ir.title || "—"}</b></span>
        <span>tainted <b>{String(props.ir.tainted)}</b></span>
      </div>
      <div className="hud-actions">
        <button className="btn ghostbtn" onClick={() => doCopy("json")}>Copy page as JSON</button>
        <button className="btn ghostbtn" onClick={() => doCopy("pw")}>Copy as Playwright</button>
        <button className="btn ghostbtn" onClick={() => setTab(tab === "ir" ? "json" : "ir")}>{tab === "ir" ? "Show JSON" : "Show IR"}</button>
        {copied && <span style={{ fontSize: 11, color: "var(--agent)", alignSelf: "center" }}>{copied}</span>}
      </div>
      <pre>{tab === "ir" ? renderIR(props.ir) : JSON.stringify(props.ir, null, 2)}</pre>
    </div>
  );
}

function renderIR(ir: PageIR): string {
  const lines: string[] = [];
  const walk = (n: PageIR["root"], d: number) => {
    lines.push(`${"  ".repeat(d)}[${n.ref}] ${n.role}${n.name ? ` "${n.name}"` : ""}${n.tainted ? " ⚠" : ""}`);
    for (const c of n.children ?? []) walk(c, d + 1);
  };
  walk(ir.root, 0);
  return lines.join("\n");
}

// ---- Permission toast -------------------------------------------------------

function PermissionToast(props: { prompt: PermissionPrompt; onRespond(allow: boolean): void }): React.JSX.Element {
  const p = props.prompt;
  return (
    <div className="perm">
      <h4>{p.irreversible ? `⚠ Irreversible: ${p.irreversible}` : "Permission needed"}</h4>
      <p>The agent wants <b>{p.capability}</b>{p.target ? ` on “${p.target}”` : ""} at <b>{p.domain}</b> (Space: {p.space}). {p.reason}</p>
      <div className="row">
        <button className="btn" onClick={() => props.onRespond(true)}>Grant</button>
        <button className="btn stop" onClick={() => props.onRespond(false)}>Deny</button>
      </div>
    </div>
  );
}

function shortParams(p: Record<string, unknown>): string {
  const s = JSON.stringify(p);
  return s.length > 60 ? s.slice(0, 57) + "…" : s;
}
