# Proa — Architecture

Proa is an agent-native browser for developers: a runtime in which agents are first-class
users and humans ride along. This document is the map. It describes the process model, the
engine boundary, every package's responsibility with its real exported surface, and the
control flow of a single agent step. Decisions are recorded as ADRs in
[`docs/DECISIONS.md`](./DECISIONS.md); this document explains the system they produced.

**Repo:** <https://github.com/bloxy-studios/proa> · Apache-2.0 · TypeScript strict everywhere.

---

## 1. Shape of the system in one paragraph

An agent run is a loop that lives **outside** the page: perceive the page as a compact,
accessibility-first **Page IR**, ask a **ModelProvider** for exactly one tool call, put that
tool call through a **PermissionEngine** that never consults the model, dispatch it to an
**EngineAdapter**, append every event to a **hash-chained trace**, and repeat until a budget,
a `done`, or a `stop` ends the run. Everything above the `EngineAdapter` line is pure
TypeScript with no Electron and no display, which is why the SDK, CLI, MCP server, and the
full CI benchmark run in plain Node.

---

## 2. Design invariants

These are the properties every part of the codebase is required to preserve. Break one and
the product stops being the product.

| # | Invariant | Enforced by | ADR |
|---|---|---|---|
| 1 | Agent logic never executes in page context. The runtime supervises tabs from outside. | `EngineAdapter` is the only way to touch a page (`packages/protocol/src/engine.ts`) | 0001 |
| 2 | `@proa/core` never imports Electron. | `packages/core/package.json` has no Electron dependency; engines are injected | 0001 |
| 3 | Agents act on stable IR `ref`s, never CSS selectors. | `IRNode.ref`, `EngineTab.click(ref)` | 0003 |
| 4 | Permission decisions are structural and live outside the model. | `classifyAction()` takes `(AgentAction, PageIR)` only | 0005 |
| 5 | Page-derived text reaches the model only inside a tagged data block. | `buildUserMessage()` in `packages/core/src/providers/prompt.ts` | — |
| 6 | Every run produces a tamper-evident trace. | `TraceWriter` hash-chains; `verifyChain()` proves it | — |
| 7 | Parity: the same verbs in UI, SDK, CLI, and MCP. | `TOOL_NAMES` in `@proa/protocol`; `TOOL_DEFS` in `@proa/mcp` | — |
| 8 | CI needs no API key and no external network. | `MockProvider` + `DomEngine` + bundled fixture site | 0006 |

---

## 3. Repository map

```
proa/
├── apps/browser/          desktop shell — Electron main + preload + React renderer  (see §4.1)
├── packages/
│   ├── protocol/          shared contracts: capabilities, tools, Page IR, traces, EngineAdapter
│   ├── extractor/         Page IR distillation + taint sanitizer + heuristic schema mapper
│   ├── permissions/       capability engine + audit ledger
│   ├── traces/            hash-chained JSONL store, replayer, differ, Playwright exporter
│   ├── core/              engine-agnostic agent runtime: DomEngine, agent loop, providers
│   ├── sdk/               @proa/sdk — launch()/connect(), tabs, typed extract, agents.run
│   ├── cli/               the `proa` binary
│   └── mcp/               MCP stdio server + token-gated HTTP bridge
├── fixtures/testsite/     the bundled fixture site (login, table, form, pagination, traps)
├── benchmark/             the five-task deterministic agent benchmark
├── examples/              runnable task files for `proa run`
└── docs/                  ADRs, this file, DEMO.md
```

Dependency direction is strictly one-way:

```
protocol  ←  extractor  ←  core  ←  sdk  ←  cli
   ↑            ↑          ↑        ↑       ↑
   └── permissions ────────┘        │       │
   └── traces ──────────────────────┘       │
                          mcp ──────────────┘
```

`@proa/protocol` depends only on `zod`. Nothing depends on `@proa/cli`.

---

## 4. Process model

### 4.1 Desktop (Electron)

`apps/browser` is a real Electron app: a **main** process that owns every piece of durable
state, a **preload** that exposes exactly one typed bridge, and a **renderer** that is pure
chrome. The page is never part of the renderer — each tab is a native `WebContentsView`
child inset into the web card.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ MAIN  (apps/browser/src/main)                                                  │
│                                                                                │
│  index.ts   BrowserWindow · Spaces · layout · ipcMain handlers · agent runs    │
│  engine.ts  ChromiumEngine — implements the @proa/protocol Engine over CDP     │
│  state.ts   AppState (better-sqlite3, WAL): LedgerStore + history + spaces     │
│             + trace_index                                                      │
│                                                                                │
│  PermissionEngine  @proa/permissions   store = AppState, prompter = UI toast   │
│  FileTraceStore    @proa/traces        <userData>/traces/<id>.jsonl            │
│  runAgent()        @proa/core          one AbortController per run             │
│  ProaSession       @proa/mcp           serveBridge on 127.0.0.1:8787 + token   │
│        │                                                                       │
│        └─ webContents.debugger ── CDP ──┐                                      │
└─────────────────────────────────────────┼──────────────────────────────────────┘
                                          │
  ┌───────────────────────────────────────┴───┐   ┌───────────────────────────────┐
  │ WebContentsView — one per tab, per Space  │   │ RENDERER — chrome only        │
  │ session.fromPartition("persist:proa-<id>")│   │ App.tsx: sidebar · web card   │
  │  sandbox: true, contextIsolation: true    │   │  · agent console · palette    │
  │  page content — untrusted                 │   │  · Dev HUD · permission toast │
  │  NO agent code ever runs here             │   │                               │
  │  bounds = the web card's rect             │◀──│  preload → window.proa        │
  └───────────────────────────────────────────┘   │  (ProaBridge, contextBridge)  │
                                                  └───────────────────────────────┘
```

Key points:

- **The agent is a main-process supervisor, not an injected script.** It reaches the page
  only through CDP commands issued via `webContents.debugger`. What runs *in* the page is
  mechanical and decision-free: a pure DOM serializer, an `el.click()`, a `getBoundingClientRect()`.
  A compromised page can lie about its content; it cannot reach into the agent's memory, its
  task, or its grants.
- **Tabs are native views, not renderer DOM.** `layout()` computes one rectangle — the window
  minus sidebar, top bar, and (when open) the agent console — and hands it to
  `ChromiumEngine.setBounds()`; `setActive(tabId)` toggles visibility. Because a native view
  composites *above* the window's own web contents, opening the command palette or the Dev HUD
  sends `overlay:set` to main, which calls `hideAll()` so the chrome overlay is actually visible.
- **Spaces are cookie-jar boundaries.** Each Space owns its own `ChromiumEngine` over
  `session.fromPartition("persist:proa-<id>")`, so a compromised run in one Space cannot read
  another Space's cookies (ADR-0001). Grants are keyed to `(agent, capability, domain, space)`
  on top of that.
- **The renderer is a view.** All durable state lives in main and is persisted to SQLite (WAL).
  Panes subscribe; they do not own state. This is what makes crash-safe restore and the
  "one keystroke = one SDK call" parity possible.
- **One typed bridge.** `src/preload/index.ts` `contextBridge`-exposes `window.proa`, whose
  shape is the `ProaBridge` interface in `src/shared/types.ts` — spaces, tabs, history, `pageIR`,
  `copyPageAsJSON`, `copyAsPlaywright`, `ledger`, `runAgent`/`stopAgent`, `respondPermission`,
  `mcpBridgeInfo`. Every entry is one `ipcRenderer.invoke` to a handler in `index.ts`; the
  renderer imports no Node and no Electron internals.
- **Agent runs stream over IPC.** `agent:run` starts `runAgent()` against the Space's engine and
  pushes `AgentUpdate`s on `agent:update`: `thought`, `step`, `ghost`, `permission`, `outcome`.
  The ghost payload is the normalized (0..1) centre of the acted-on `ref`, from
  `ChromiumTab.rectOf()`. A permission prompt is the `Prompter` itself — main parks a promise,
  the renderer answers via `permission:respond`, and an unanswered prompt auto-**denies** after
  45 s. When the run ends, the trace is written through `FileTraceStore` and indexed in SQLite.
- **The MCP bridge is live inside the app.** On startup main constructs a `ProaSession` over the
  active Space's engine and `serveBridge`s it on `127.0.0.1:8787` with a random hex token, so
  Claude Code drives *visible* tabs under the same permission engine as the in-app agent. Two
  honest limits: the session is bound to the Space that was active at launch (switching Spaces
  does not rebind it), and MCP-opened tabs are tracked by the session rather than the UI tab
  model, so they do not appear in the sidebar. If the port is taken, the bridge is silently
  disabled and `mcpBridgeInfo()` reports `null`.
- **SQLite is scoped to the app.** `better-sqlite3` is a native module and lives only in
  `apps/browser` (ADR-0004). The portable packages persist through injectable interfaces:
  `LedgerStore` for grants and `FileTraceStore` (plain JSONL) for traces. `AppState`
  (`src/main/state.ts`) *is* the `LedgerStore` implementation — `append`/`list`/`hasGrant`/
  `grant`/`revoke`/`grants` over the `ledger` and `grants` tables — alongside `spaces`,
  `history`, and `trace_index`.

### 4.2 Headless (Node)

```
┌───────────────────────────────────────────────────────────┐
│ single Node process                                       │
│                                                           │
│   proa run task.ts  |  @proa/sdk launch()  |  proa mcp    │
│                     ↓                                     │
│              @proa/core runAgent()                        │
│                     ↓  EngineAdapter                      │
│              DomEngine (jsdom)                            │
│                     ↓  Resolver                           │
│        fixture `resolve(path)`  or  global fetch()        │
└───────────────────────────────────────────────────────────┘
```

Same loop, same IR, same permission engine, same trace format. The only thing that changes
is which `Engine` implementation is plugged in. `DomEngine` cannot render pixels
(`screenshot()` returns `{ ref, placeholder: true }`) and has no layout, so `scroll()` is a
successful no-op — those are the honest limits of the headless engine.

### 4.3 Status of the desktop surface — verified where

The app in §4.1 exists and is wired end to end. What differs between it and the rest of the
repo is not *whether* it ships but *where it is verified*, because Electron cannot launch on
the headless build machine at all (no display, no root, no `xvfb` — ADR-0007).

| | Verified how |
|---|---|
| `apps/browser` compiles | **locally**: `pnpm --filter @proa/browser typecheck` is green (its own `tsconfig.json`, covering `src/`, `e2e/`, and the Playwright config). Note the root project excludes `apps/**`, so `pnpm verify` does *not* typecheck the app — run the filtered command |
| app runtime, Playwright-on-Electron e2e, live screenshots, `.app` packaging | **in CI**: the macOS `app` job (build → typecheck → e2e → screenshot artifacts) and the release job. Treat those as the source of truth for the GUI |
| everything engine-agnostic | **locally and in CI**: `pnpm verify` + the five-task benchmark on `DomEngine` + `MockProvider` |

Two caveats to keep in mind when reading §4.1 (see also
[`KNOWN_GAPS.md`](../KNOWN_GAPS.md), which tracks the second one):

- The e2e suite (`apps/browser/e2e/shell.e2e.ts`) currently covers the **shell**: the
  three-surface layout renders, ⌘T opens the palette and searches, the agent console is
  present. It is wired with `continue-on-error` in `ci.yml` while it stabilises, so macOS is
  additive rather than a hard gate today. The ubuntu-under-`xvfb` variant is sketched in the
  workflow but commented out.
- `ChromiumEngine` has **no unit coverage** — it is typechecked only, and its runtime is exercised
  in the macOS CI e2e job rather than on the headless build machine. `snapshot()` builds the IR
  through the `BuildMeta.onNode` hook, recording a `ref → data-proa-ref` map so that
  `click`/`type`/`select`/`waitFor({ref})`/`rectOf()` translate the agent-facing IR ref (`n12`) to
  the page's stamped `data-proa-ref` (`r40`) before resolving `[data-proa-ref=…]` — the same hook
  the headless `DomEngine` uses to build its map. The remaining gap is that this translation is
  covered by typecheck + the DomEngine's equivalent tests, not yet by a Chromium e2e that runs an
  actual agent step; adding that e2e is a tracked follow-up (KNOWN_GAPS.md).

`ChromiumEngine` is bounded by the `Engine`/`EngineTab` interface in §5; anything it does that
is not expressible there is a bug in the boundary.

---

## 5. The engine boundary

`packages/protocol/src/engine.ts` is the single seam between the runtime and a browser.
It is deliberately small — every method maps to one CDP call or one jsdom operation.

```ts
export interface Engine {
  readonly name: string;
  openTab(url?: string): Promise<EngineTab>;
  listTabs(): Promise<EngineTab[]>;
  getTab(id: string): Promise<EngineTab | undefined>;
  close(): Promise<void>;
}

export interface EngineTab {
  readonly id: string;
  snapshot(): Promise<PageIR>;                 // accessibility-first distillation
  navigate(url: string): Promise<void>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  click(ref: string): Promise<void>;           // ref, never a selector
  type(ref: string, text: string, opts?: { submit?: boolean }): Promise<void>;
  select(ref: string, value: string): Promise<void>;
  scroll(opts: ScrollOptions): Promise<void>;
  waitFor(opts: WaitForOptions): Promise<boolean>;
  screenshot(opts?: { fullPage?: boolean }): Promise<ScreenshotResult>;
  getState(): Promise<EnginePageState>;
  networkSummary(): Promise<NetworkSummary>;
  close(): Promise<void>;
}
```

Supporting types: `EnginePageState { url, title, canGoBack, canGoForward }`,
`NetworkSummary { requests, failed, bytes, domains }`,
`ScreenshotResult { ref, bytes?, placeholder? }`, `ScrollOptions`, `WaitForOptions`.

Two implementations ship:

| | `ChromiumEngine` | `DomEngine` |
|---|---|---|
| Location | `apps/browser/src/main/engine.ts` | `packages/core/src/engine/dom-engine.ts` |
| Backing | Electron `WebContentsView` + `webContents.debugger` (CDP) | jsdom |
| Pixels | real screenshots (`webContents.capturePage()`) | `{ placeholder: true }` |
| JS execution | full | jsdom's subset; forms submitted by synthesising the GET/POST URL |
| Cookie jar | per-Space `session.fromPartition` | none (it fetches/loads HTML) |
| Verified | typecheck + CI e2e (§4.3) | unit tests + the five-task benchmark |
| Used by | the desktop app | `proa run --headless`, `proa mcp serve`, `sdk.launch()`, benchmark, unit tests |

How `ChromiumEngine` satisfies the interface without putting agent logic in the page: a small
pure serializer is evaluated over CDP (`Runtime.evaluate`) and returns a compact
`{ tag, attrs, text, children }` tree plus `url`/`title`; a `DomLikeAdapter` in main wraps that
tree in the extractor's `DomLikeElement` shape, so **the same `buildPageIR` runs behind both
engines**. `Network.enable` events feed `networkSummary()`; `screenshot()` ignores `fullPage`
and returns a viewport capture. See §4.3 for what is and is not verified about this path.

`DomEngine` takes a `Resolver` (`(url) => string | Promise<string>`). The benchmark and the
examples inject the fixture site's `resolve()` for hermetic, offline determinism; with no
resolver it falls back to `fetch()` for the real web.

---

## 6. Packages

### 6.1 `@proa/protocol` — the shared contracts

Pure types, zod schemas, and tiny pure helpers. Everything else imports it; it imports only
`zod`. `PROTOCOL_VERSION = "0.1.0"`.

| Module | Exports |
|---|---|
| `capabilities.ts` | `CAPABILITIES`, `Capability`, `FREE_CAPABILITIES`, `IRREVERSIBLE_CLASSES`, `IrreversibleClass`, `isFreeCapability()` |
| `tools.ts` | `TOOL_NAMES`, `ToolName`, `DONE_TOOL`, per-tool zod param schemas (`NavigateParams`, `ClickParams`, `TypeParams`, …), `TOOL_PARAM_SCHEMAS`, `TOOL_BASE_CAPABILITY`, `AgentAction`, `ActionResult` |
| `ir.ts` | `IRNode`, `IRNodeState`, `PageIR`, `walkIR()`, `findNode()`, `findByRef()` |
| `schema.ts` | `SchemaSpec`, `isObjectSpec()`, `isArraySpec()` |
| `traces.ts` | `TRACE_EVENT_TYPES`, `TraceEventType`, `TraceEvent`, `TraceMeta` |
| `agent.ts` | `Budget`, `DEFAULT_BUDGET`, `AgentStep`, `RunStatus`, `Artifact`, `RunOutcome`, `ModelContext`, `ModelDecision`, `ModelUsage`, `ModelHistoryEntry`, `ModelProvider` |
| `engine.ts` | `Engine`, `EngineTab`, and the supporting types in §5 |

The capability vocabulary is closed:

```ts
CAPABILITIES        = ["read","act:click","act:type","act:select","act:scroll","act:submit","download"]
FREE_CAPABILITIES   = ["read","act:scroll"]
IRREVERSIBLE_CLASSES= ["payment","auth","delete","send"]
```

`TOOL_BASE_CAPABILITY` maps every tool to the capability it needs *before* per-target
classification: `navigate`/`waitFor`/`extract`/`screenshot`/`tabs.*`/`askHuman` → `read`,
`scroll` → `act:scroll`, `click` → `act:click`, `type` → `act:type`, `select` → `act:select`,
`download` → `download`. The permission engine may escalate from there; it never de-escalates.

### 6.2 `@proa/extractor` — Page IR and typed extraction

Four files, one job: turn a DOM into something an agent can safely reason about.

- **`dom.ts`** — `DomLikeElement` / `DomLikeNode`: a minimal structural subset of the W3C DOM
  (`tagName`, `getAttribute`, `hasAttribute`, `children`, `childNodes`, `textContent`). The
  extractor is typed against *this*, not against jsdom, which is exactly why the same IR code
  runs behind both engines. Helpers: `childElements()`, `directText()`, `collapse()`.
- **`roles.ts`** — the accessibility mapping. `roleOf()` prefers an explicit `role` attribute,
  then maps tag → ARIA role (`a`→`link`, `tr`→`row`, `th`→`columnheader`, …) and
  `input[type]` → role (`password`→`textbox`, `number`→`spinbutton`, …). `SKIP_TAGS` drops
  `script`/`style`/`head`/… `accessibleName()` resolves `aria-label` → `<label for>` →
  `placeholder` → `name` → text content. `isInteresting()` decides what survives distillation;
  everything else is flattened away, which is what keeps the IR token-frugal.
- **`taint.ts`** — the sanitizer. `detectHidden()` returns structured reasons
  (`hidden-attr`, `aria-hidden`, `display-none`, `visibility-hidden`, `opacity-0`,
  `zero-size`, `offscreen`, `sr-only-class`, `type-hidden`). `detectInjection()` matches ten
  imperative patterns ("ignore all previous instructions", "you are now", "system prompt",
  "do not tell the user", …) and adds `hidden-instruction` when hidden text also reads like
  instructions.
- **`build.ts`** — `buildPageIR(root, meta): PageIR`. Deterministic: refs are assigned in
  emission order (`n0`, `n1`, …), so the same DOM always yields the same IR, which is what
  makes replay and trace diffing meaningful. Three behaviours matter:
  1. **Hidden subtrees** are inspected in full. If they contain injection bait, a *redacted*
     flagged node is emitted (`name: "[tainted content withheld]"`, `tainted: true`,
     `taintReasons`, `state.hidden`); otherwise the subtree is dropped entirely. Either way
     the literal text never enters the IR.
  2. **Visible elements** are tainted only by their own direct text, never by aggregate
     descendant text — otherwise every ancestor of any bait would be flagged.
  3. **Secrets are redacted at capture.** `type="password"` or a name/id/autocomplete matching
     `pass|secret|token|api[-_]?key|cvv|card[-_]?number|ssn|otp` sets `state.secret` and
     replaces the value with `•••`; values matching `sk-…`, a JWT prefix, or a 32+ hex run
     become `[redacted secret]`.
  `BuildMeta.onNode(ref, el)` is the hook engines use to build their `ref → element` map,
  which is how a `ref` becomes a real click.
- **`map.ts`** — `mapSchema(ir, spec): MapResult { value, confidence }`. Heuristic, three
  paths: an HTML **table** (header-name match, then positional fallback; confidence `0.95` —
  this is the golden-file path), **repeated list items** (`0.7`), and a scalar-array/object
  fallback. Coercion handles currency and thousands separators, `yes/true/in stock/✓`
  booleans, and enum normalisation.

### 6.3 `@proa/permissions` — the capability engine

This package is the injection defense. It is 200 lines and it never imports a model.

- **`classify.ts`** — `classifyAction(action, ir?): ActionClassification`. Starts from
  `TOOL_BASE_CAPABILITY`, resolves `params.ref` against the IR to get the target's accessible
  name, then escalates:
  - target name matches an irreversible pattern → `{ capability, irreversible: "payment" | "delete" | "send" | "auth" }`;
  - `type` with `submit: true`, or a click on a submit-like button → `act:submit`;
  - `download` → always the `download` capability.
  The patterns are deliberately broad: a false positive costs one extra confirmation, a false
  negative costs trust.
- **`ledger.ts`** — `LedgerStore` is the persistence seam: `append`, `list`, `hasGrant`,
  `grant`, `revoke`, `grants`. `GrantKey = { agent, capability, domain, space }` — grants are
  scoped to all four, so a grant in the `work` Space does nothing in `personal`.
  `MemoryLedgerStore` is the default; the desktop app supplies the SQLite implementation
  (`AppState` in `apps/browser/src/main/state.ts`).
- **`engine.ts`** — `PermissionEngine.check(args): Promise<PermissionDecision>` in four steps:

  ```
  1. free capability (read, act:scroll) and not irreversible  → allow, no prompt
  2. irreversible class                                       → ALWAYS prompt fresh,
                                                                 never remembered
  3. remembered grant for (agent, capability, domain, space)  → allow
  4. otherwise                                                → prompt once; remember on yes
  ```

  Every branch calls `store.append(...)`, so allow *and* deny both land in the ledger. The
  default prompter is `denyAll`; `allowAll` and `allowReversibleOnly` ship as conveniences
  (`allowReversibleOnly` is what the benchmark and the MCP session use — it approves ordinary
  writes and refuses the irreversible class, which is exactly the headless-safe posture).
  `domainOf(url)` extracts the host, falling back to `"local"`.

### 6.4 `@proa/traces` — sessions as artifacts

- **`hash.ts`** — `stableStringify()` (recursive key sort), `sha256()`, and
  `hashEvent(seq, ts, type, payload, prevHash)` computing
  `sha256("${seq}|${ts}|${type}|${stableJson(payload)}|${prevHash}")`.
- **`writer.ts`** — `TraceWriter.append(type, payload)` chains each event to the previous
  hash and returns the `TraceEvent`. `headHash`, `events()`, `toJSONL()`.
  `verifyChain(events): VerifyResult` recomputes the whole chain and reports
  `{ ok: false, brokenAt, reason }` on the first divergence — so editing a payload after the
  fact is detectable, not merely discouraged.
- **`store.ts`** — `FileTraceStore(rootDir)`: `create(meta)` writes the
  `{"kind":"proa.trace.meta",…}` header then appends each event to `<traceId>.jsonl` as it
  happens (genuinely append-only, not buffered), `screenshotDir(traceId)`, `list()`, `read()`.
- **`parse.ts`** — `parseJSONL(text): ParsedTrace { meta, events }`.
- **`replay.ts`** — `extractActions()`, `extractSnapshots()`, and `Replayer` whose `steps()`
  pairs each `step.action` with the `ir.snapshot` that preceded it. That pairing is the
  substrate for both the differ and the exporter.
- **`diff.ts`** — `diffTraces(a, b): TraceDiff` compares action sequences and reports
  per-index `tool` / `params` / `presence` deltas. "Did my prompt change break the agent?"
  becomes a reviewable diff.
- **`playwright.ts`** — `toPlaywrightTest(trace, opts?)` emits a runnable
  `@playwright/test` file. Each `ref` is resolved through the preceding IR snapshot into a
  `page.getByRole(role, { name })` locator (falling back to `getByText`, then
  `page.locator("body")`). Typing into a node with `state.secret` emits
  `process.env.PROA_SECRET ?? "REDACTED"` instead of the literal — a recorded login exports to
  a test you can commit.

Event types: `run.start`, `step.thought`, `step.action`, `step.result`,
`permission.decision`, `ir.snapshot`, `screenshot`, `network.summary`, `run.end`.

### 6.5 `@proa/core` — the runtime

- **`engine/dom-engine.ts`** — `DomEngine` / `DomEngineOptions` / `Resolver` (§5).
- **`providers/prompt.ts`** — `serializeIR()` renders the IR as an indented outline
  (`[n12] button "Sign in"`, `⚠ TAINTED[...]` on flagged nodes), `SYSTEM_PROMPT`,
  `buildUserMessage(ctx)`, and `AGENT_TOOLS_FOR_MODEL`.
- **`providers/mock.ts`** — `MockProvider(script)` replays `MockScriptStep[]`, where each step
  is either a fixed `ModelDecision` or a function of the live `ModelContext` (so scripts can
  resolve refs against the current IR and stay robust to renumbering). `refByName(ir, name, role?)`
  and `refByRole(ir, role)` are the helpers that make scripts readable.
- **`providers/anthropic.ts`** — `AnthropicProvider`, the first-class implementation. Posts to
  `/v1/messages` with `system: SYSTEM_PROMPT`, a generated `tools` array, and
  `tool_choice: { type: "any" }`, then maps the returned `tool_use` block to an `AgentAction`
  and reports `usage`. Uses `fetch` directly rather than pulling in a heavy SDK.
- **`providers/openai.ts`** — `OpenAIProvider`, any OpenAI-compatible endpoint
  (`OPENAI_BASE_URL` covers Together/Ollama/vLLM). Single JSON tool call via
  `response_format: { type: "json_object" }`, `temperature: 0`.
- **`agent/loop.ts`** — `runAgent(args): Promise<RunOutcome>` (§7).
- **`ids.ts`** — `newTraceId(prefix = "t")`.

`@proa/core` also re-exports `buildPageIR` and `mapSchema` so downstream callers have one
import surface.

### 6.6 `@proa/sdk` — the developer surface

```ts
import { proa } from "@proa/sdk";
import { z } from "zod";

const app  = await proa.launch({ headless: true });      // DomEngine, in-process
const tab  = await app.tabs.open("https://example.com");
const Item = z.object({ name: z.string(), price: z.number() });
const rows = await tab.extract(z.array(Item).max(10));   // Page IR → SchemaSpec → typed JSON

const run = app.agents.run("add the cheapest item to the cart", {
  budget: { maxSteps: 20 },
  permissions: { "example.com": ["click", "type"] },
  startUrl: "https://example.com/products",
});
for await (const step of run.steps()) console.log(step.thought, "→", step.action.tool);
const outcome = await run.result();
```

- `launch(opts: LaunchOptions)` → a `ProaApp` over a fresh `DomEngine`. `connect(opts: ConnectOptions)`
  → a `ProaApp` that proxies every verb to a running Proa's HTTP bridge (`POST /call`,
  optional bearer), defaulting to `$PROA_ENDPOINT` or `http://127.0.0.1:8787`. Both return the
  *same* `ProaApp` interface — that is the parity principle expressed as a type.
- `Tab`: `goto`, `ir()`, `extract(zodSchema)`, `screenshot()`, `close()`.
- `AgentRun`: `steps()` (async-iterable, pushed live from the loop's `onStep`), `result()`,
  `trace()`, `stop()` (an `AbortController` the loop observes → `RunStatus "stopped"`).
- `zodToSchemaSpec(schema)` converts object / array (with `.max()`) / string (`.url()`,
  `.email()`) / number / boolean / enum / optional / nullable / default into a `SchemaSpec`.
  `zod` is a **peer** dependency, so the extractor never depends on how you expressed the schema.
- `engineFromSpec({ "site.com": ["click"] })` builds a `PermissionEngine` pre-granted with
  those reversible capabilities and a `denyAll` prompter — a headless run therefore cannot
  obtain a fresh grant for the irreversible class, by construction.

### 6.7 `@proa/cli` — the `proa` binary

Built with `commander`; `packages/cli/src/program.ts` is the whole surface.

| Command | Notes |
|---|---|
| `proa doctor` | Node ≥ 20, display availability, headless engine, model key, Electron resolution |
| `proa run <file> [--json] [--headless]` | Imports a TS/ESM task file (via `tsx/esm/api`'s `tsImport` for `.ts`); `--json` sets `PROA_JSON=1`, and `PROA_HEADLESS=1` is always set |
| `proa trace ls [--dir]` | Lists trace metas newest-first |
| `proa trace replay <id> [--dir]` | Runs `verifyChain()` then prints the deterministic action sequence |
| `proa trace export <id> --as playwright [--dir] [--out]` | `toPlaywrightTest()` to stdout or a file |
| `proa mcp serve [--http] [--port] [--token]` | stdio by default; `--http` starts the bridge |
| `proa open <url> [--endpoint]` | Opens a tab in a *running* Proa via `connect()` |

Trace directory defaults to `$PROA_TRACE_DIR` or `.proa/traces`. On stdio, all logging goes
to stderr so stdout stays a clean MCP channel.

### 6.8 `@proa/mcp` — the browser as an MCP server

- **`tools.ts`** — `TOOL_DEFS: ProaToolDef[]`, kept as plain data so the tool list can be
  golden-tested without importing the MCP SDK. Seventeen tools, in this exact order:
  `ping`, `tabs.open`, `tabs.close`, `tabs.list`, `navigate`, `ir`, `click`, `type`, `select`,
  `scroll`, `waitFor`, `extract`, `screenshot`, `download`, `agent.run`, `agent.stop`,
  `ledger`. (Note the name collision: `@proa/mcp`'s `TOOL_NAMES` is this list;
  `@proa/protocol`'s `TOOL_NAMES` is the agent's own tool vocabulary.)
- **`session.ts`** — `ProaSession` owns an `Engine` and a `PermissionEngine`, keeps a tab map
  with a lazily-created current tab, and routes `call(name, args)` through `dispatch()`.
  Crucially, `click`/`type`/`select` each call `gate()` first — snapshot the IR, resolve the
  domain, run `permissions.check()` — and throw `permission-denied` when refused. **An
  external MCP client gets exactly the same guarantees as the in-app agent.** Defaults:
  `space = "mcp"`, `agentId = "mcp-client"`, prompter `allowReversibleOnly`. The desktop app
  overrides that by handing the session **its own** `PermissionEngine` (§4.1), so a write
  requested over MCP raises the same on-screen permission toast a local agent would.
- **`server.ts`** — `createMcpServer(session)` registers every `TOOL_DEFS` entry on an
  `McpServer` with a zod shape derived from the declared params; `serveStdio(session)` attaches
  a `StdioServerTransport`.
- **`http.ts`** — `createBridge` / `serveBridge`: `POST /call` (and `/mcp/call`) taking
  `{ tool, params }`, optional `Bearer` token, permissive CORS, plus an unauthenticated
  `GET /health`. This is what the SDK's `connect()` speaks, and what the desktop app starts on
  `127.0.0.1:8787` at launch so an external agent can drive visible tabs (§4.1).

### 6.9 `@proa/testsite` and `@proa/benchmark`

`fixtures/testsite` is a single pure function — `resolve(path): string` — rendering
`/`, `/login`, `/products`, `/cart`, `/form`, `/list`, `/trap`, `/account`. Because it is a
pure function, the *same* site backs the HTTP server used by Playwright e2e
(`createTestSite()`, `startTestSite(port = 4321)`) and the in-process `DomEngine` resolver used
by the benchmark — zero external-network flakiness, byte-identical pages in both modes.
It exports `PRODUCTS`, `CHEAPEST`, `PROFILE`, and `ROUTES` so assertions reference data rather
than string literals.

`benchmark/src/tasks.ts` defines the five tasks; each builds a `DomEngine` over `resolve`, a
`MockProvider` script, a `PermissionEngine({ prompter: allowReversibleOnly })`, and a
`TraceWriter`, then asserts against the resulting outcome, trace, and final page state:

| Task | What it proves |
|---|---|
| `login` | the password field is gated as `act:type`, and the flow reaches `Dashboard` |
| `cheapest-to-cart` | multi-step reasoning over extracted data → the correct cart |
| `multi-page-form` | a three-step form filled from `PROFILE` survives to the summary page |
| `extract-table` | typed extraction equals `benchmark/golden/products.json` byte-for-byte |
| `injection-trap` | the IR flagged the bait **and** the permission engine denied the irreversible delete **and** the page never reached `action=delete` |

`runBenchmark({ traceDir })` optionally writes each task's trace as JSONL so the CLI's trace
commands have real material to work on.

---

## 6a. Parity matrix

The same verb, four surfaces. If a capability exists only as pixels, it was built wrong.

| Verb | Desktop UI | SDK | CLI | MCP |
|---|---|---|---|---|
| open a tab | ⌘T / palette | `app.tabs.open(url)` | `proa open <url>` | `tabs.open` |
| navigate | URL pill → palette | `tab.goto(url)` | (task file) | `navigate` |
| read the page | Dev HUD IR viewer | `tab.ir()` | (task file) | `ir` |
| typed extract | Dev HUD → Copy page as JSON *(emits the Page IR; schema mapping is SDK/agent-side)* | `tab.extract(zodSchema)` | `proa run task.ts --json` | `extract` |
| click / type / select | ride-along | agent tools | (task file) | `click` / `type` / `select` |
| run an agent | agent console | `app.agents.run(task, opts)` | `proa run task.ts` | `agent.run` |
| stop | Stop button / Esc Esc | `run.stop()` | Ctrl-C | `agent.stop` |
| audit | ledger badge ⛨ (count) | `app.ledger(domain, space)` | — | `ledger` |
| export | Dev HUD → Copy as Playwright *(current page)* | `toPlaywrightTest()` | `proa trace export --as playwright` | — |

---

## 7. The agent loop

`packages/core/src/agent/loop.ts`, function `runAgent`. One tool call per iteration, budgets
checked first, permission gate between decide and act.

```mermaid
sequenceDiagram
    participant L as runAgent (loop)
    participant E as EngineAdapter
    participant P as ModelProvider
    participant G as PermissionEngine
    participant T as TraceWriter

    L->>T: run.start {task, budget, provider}
    loop until done / budget / stop
        L->>L: check signal.aborted → "stopped"
        L->>L: check steps ≥ maxSteps → "budget-exceeded"
        L->>L: check wall clock → "budget-exceeded"
        L->>E: snapshot()
        E-->>L: PageIR
        L->>T: ir.snapshot
        L->>P: decide({task, ir, history, tools, budgetLeft})
        P-->>L: {thought, action, usage?}
        L->>T: step.thought
        Note over L: action.tool === "done" → finish("completed")
        L->>T: step.action
        L->>G: check({agent, space, domain, action, ir})
        G-->>L: PermissionDecision (+ ledger entry)
        L->>T: permission.decision
        alt denied
            Note over L: result = { ok:false, error:"permission-denied" }
        else allowed
            L->>E: dispatch one tool
            E-->>L: ActionResult
        end
        L->>T: step.result
        L->>L: onStep(step); steps++
    end
    L->>T: run.end {status, summary, steps}
```

Notes on the real behaviour:

- **A denied action is not an exception.** It becomes an `ActionResult` with
  `error: "permission-denied"` and a human-readable summary, which is fed back to the model as
  history. The agent learns it cannot do that and moves on; the run does not crash.
- **`tabs.open` retargets the loop.** If a tool call opens a tab, `current` switches to it.
- **`extract`** snapshots, runs `mapSchema`, pushes a `{ kind: "json" }` `Artifact`, and
  returns the value in `ActionResult.data` — which is how the `cheapest-to-cart` benchmark
  task reasons over its own previous extraction.
- **`askHuman`** ends the run as `needs-human` with `RunOutcome.question` set, unless a
  `humanAnswer` callback is supplied and returns a string. Headless runs never hang.
- **`download`** is gated by the `download` capability; in v0.1 the dispatch is a stub that
  always returns `{ quarantined: true }` and writes no bytes to disk.

### Budgets

`Budget { maxSteps, maxTokens?, maxCostUsd?, maxWallClockMs? }`, `DEFAULT_BUDGET = { maxSteps: 40 }`.
All four are **enforced**, checked in that order at the top of every iteration before perceiving,
so a run can never spend a step it has no budget for. `maxTokens` and `maxCostUsd` accumulate
from each decision's `ModelUsage` (`inputTokens + outputTokens`, and `costUsd`) as it is recorded
into the `step.thought` trace event; the next iteration compares the running total against the
budget and finishes as `budget-exceeded` with a summary naming which one ran out. Providers that
report no `usage` — `MockProvider`, for instance — simply never accumulate, so token and cost
budgets are only as good as the provider's accounting.

`RunStatus` is one of `completed | failed | budget-exceeded | stopped | needs-human`. Every
terminal path goes through the same `finish()` helper, so every run — including a stopped or
over-budget one — emits `run.end` and returns a complete `RunOutcome` with a `traceId`.

---

## 8. Page IR

```jsonc
{
  "url": "https://fixture.test/login",
  "title": "Login",
  "capturedAt": "1970-01-01T00:00:00.000Z",
  "nodeCount": 9,
  "tainted": false,
  "root": {
    "ref": "n0", "role": "document", "name": "Login",
    "children": [
      { "ref": "n2", "role": "heading", "name": "Login", "level": 1 },
      { "ref": "n4", "role": "textbox", "name": "Username", "value": "" },
      { "ref": "n5", "role": "textbox", "name": "Password", "value": "•••",
        "state": { "secret": true } },
      { "ref": "n6", "role": "button", "name": "Sign in" }
    ]
  }
}
```

Properties that matter, and where they come from:

| Property | Mechanism |
|---|---|
| accessibility-first | `roleOf()` + `accessibleName()` in `roles.ts` (ADR-0003) |
| stable refs | emission-order counter in `buildPageIR`; identical DOM → identical IR |
| token-frugal | `isInteresting()` drops generic wrappers; `emitChildren` flattens them |
| secret redaction | `isSecretField()` + `readValue()` at capture time, before serialization |
| taint flags | `detectHidden()` + `detectInjection()`; bait text is *withheld*, not passed through |
| one substrate | the same `PageIR` feeds the model, `mapSchema`, `ir.snapshot` trace events, and the Playwright exporter's locator resolution |

Because refs are positional, an IR must be re-snapshotted after any mutation — the loop does
exactly this at the top of every iteration, and `DomEngine.el(ref)` throws
`unknown ref … (snapshot first)` rather than acting on a stale reference.

---

## 9. Model providers

```ts
interface ModelProvider {
  readonly name: string;
  decide(ctx: ModelContext): Promise<ModelDecision>;
}
```

`ModelContext` is `{ task, ir, history, tools, budgetLeft }`; `ModelDecision` is
`{ thought, action, usage? }`. One decision, one tool call — the loop, not the provider, owns
iteration, permissions, and tracing. Adding a provider means implementing one method.

| Provider | Status | Notes |
|---|---|---|
| `AnthropicProvider` | first-class | Messages API tool-use; `ANTHROPIC_API_KEY`, `PROA_MODEL` |
| `OpenAIProvider` | second | any OpenAI-compatible endpoint; `OPENAI_API_KEY`, `OPENAI_BASE_URL` |
| `MockProvider` | the CI backbone | scripted, deterministic, offline (ADR-0006) |

With no key configured, `sdk.launch()` and MCP's `agent.run` fall back to a `MockProvider`
that immediately finishes with a setup message rather than throwing — the browser stays usable
without a model. The desktop app does the same thing at run start: `ANTHROPIC_API_KEY` present
→ `AnthropicProvider`, absent → a one-step `MockProvider` whose `done` summary tells you to set
the key. Keys come from the environment on every surface — there is no Keychain integration in
v0.1 — and are never read from files in the repo.

---

## 10. Where to change things

| You want to… | Start here |
|---|---|
| add an agent tool | `protocol/src/tools.ts` → `EngineTab` if it needs the page → `core/src/agent/loop.ts` `dispatch()` → `mcp/src/tools.ts` + `session.ts` → CLI/SDK |
| add a capability or irreversible pattern | `protocol/src/capabilities.ts`, `permissions/src/classify.ts` |
| change what the model sees | `core/src/providers/prompt.ts` (`serializeIR`, `SYSTEM_PROMPT`, `buildUserMessage`) |
| improve extraction | `extractor/src/map.ts`; add a fixture page + a golden file |
| harden the sanitizer | `extractor/src/taint.ts`; add a trap page to `fixtures/testsite/src/site.ts` |
| add a trace event | `protocol/src/traces.ts`, then the writer call site; the chain handles the rest |
| support another engine | implement `Engine`/`EngineTab`; change nothing else |

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the workflow and [SECURITY.md](../SECURITY.md)
for the threat model these boundaries exist to satisfy.
