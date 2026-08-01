# Architecture Decision Records

Numbered, append-only. Each records a decision a senior engineer made autonomously while
building Proa v0.1, the context, and the consequences. Supersede — don't rewrite — old ADRs.

---

## ADR-0000 — Name: "Proa"

**Status:** Accepted

**Context.** The working codename was "Vessel." Naming brief (§0.3a): short (≤7 letters),
pronounceable, evokes *a craft you pilot / an environment agents inhabit*, no collision with
existing browser/devtool brands, and a clean `github.com/<name>` + npm scope.

**Options considered.** vessel, proa, wherry, dhow, ketch, hull.
- `vessel` — **rejected.** Direct collision with `rubycdp/vessel` (★684), a CDP-based browser
  automation library — the exact problem space. Also `shipping-docker/vessel` (★1059). Not clean.
- `dhow`, `ketch`, `hull` — weaker: existing repos and/or generic-word collisions.
- `wherry` — clean, good metaphor (a passenger ferry), but obscure. Kept as runner-up.
- `proa` — **chosen.** A proa is the fastest traditional sailing craft (multihull, holds
  speed records). It is unambiguously *a craft you pilot*, and **speed** is a core product
  value (palette < 100 ms, split-second interactions). 4 letters, pronounceable ("PRO-ah"),
  and the "pro" prefix quietly signals a professional/developer tool. No literal `proa`
  browser/devtool collision on GitHub or npm.

**Decision.** Product name **Proa**. Package scope `@proa/*`. CLI binary `proa`. App name `Proa`.
Used consistently everywhere.

---

## ADR-0001 — Engine & Core Stack

**Status:** Accepted

**Context.** §5 hard requirements: a Chromium-class engine with per-tab CDP; per-Space session
isolation (separate cookie jars); a headless mode sharing the same core; TypeScript strict;
SQLite (WAL) for local state; pnpm monorepo; macOS-first packaging. Forking Chromium is
forbidden.

**Decision.**
- **Desktop engine: Electron** with one `WebContentsView` per tab, `webContents.debugger`
  (attached CDP) for programmatic click/type/scroll, DOM + accessibility snapshots,
  screenshots, and network observation, and `session.fromPartition("persist:space-<id>")` for
  per-Space container isolation. Electron meets every hard requirement out of the box and
  Playwright can attach to it for e2e. CEF (too much native glue) and Tauri/WRY (macOS WKWebView
  has **no CDP** — fails requirement 1) were rejected.
- **Engine-agnostic core.** `packages/core` never imports Electron. It talks to an
  `EngineAdapter` interface (navigate, snapshot, click, type, screenshot, …). This is what keeps
  a future engine migration survivable and — critically — makes the runtime testable without a
  display.
- **Two engine adapters ship in v0.1:**
  1. `ChromiumEngine` (in `apps/browser`, backed by Electron + CDP) — powers the GUI.
  2. `DomEngine` (in `packages/core`, backed by **jsdom**) — a deterministic, headless,
     zero-display engine. It powers `proa run --headless`, the SDK's `launch({ headless: true })`,
     and the **entire CI benchmark on `MockProvider`**. This is why the SDK, CLI, MCP server, and
     all five benchmark tasks run in pure Node — in CI *and* on a machine with no GPU/display.
     See ADR-0006.
- **Language:** TypeScript strict everywhere (`noUncheckedIndexedAccess` on).
- **Build:** `tsup` (esbuild) for libraries (ESM + d.ts); `electron-vite` for the app.
- **Tests:** `vitest` (unit), Playwright-on-Electron (app e2e, CI only).
- **State:** `better-sqlite3` (WAL) — see ADR-0004 for why it's scoped to the app only.
- **Schemas:** `zod` (extraction schemas, tool params, MCP tool definitions).
- **MCP:** `@modelcontextprotocol/sdk`.

**Consequences.** The differentiating logic (Page IR, typed extraction, permission engine,
hash-chained traces, replay/diff/export, agent loop, SDK, CLI, MCP) lives in engine-agnostic
packages that install and unit-test on any Node ≥ 20 with no native display. The Electron GUI is
a thin, well-isolated surface over that core, verified in CI.

---

## ADR-0002 — Monorepo layout & cross-package resolution

**Status:** Accepted

**Decision.** pnpm workspace. Packages depend on each other via `workspace:*`. For
typecheck/test/dev, cross-package imports resolve to **source** via `tsconfig.base.json`
`paths` (and `vite-tsconfig-paths` for vitest) — no build step required to typecheck or test.
For distribution, each library builds with `tsup` treating `@proa/*` as external; `pnpm -r build`
runs in topological order so dependencies are built first.

**Consequence.** `pnpm lint && pnpm typecheck && pnpm test` need zero prior build — fast, robust
CI. `pnpm build` produces publishable `dist/` for every library.

---

## ADR-0003 — Page IR is accessibility-first

**Status:** Accepted

**Decision.** The intermediate representation an agent perceives and acts on is derived from the
**accessibility tree first** (role + accessible name + state), falling back to DOM semantics.
Every IR node carries a **stable `ref`** (a deterministic path-hash) so agents act on
`ref: "n12"`, never on brittle CSS selectors. The IR is token-frugal, redacts obvious secrets
(password fields, values matching secret patterns), and flags hidden / `aria-hidden` /
off-screen instruction bait as `tainted`. IR is the single substrate for extraction, traces, and
replay. See `docs/ARCHITECTURE.md` and `SECURITY.md`.

---

## ADR-0004 — SQLite is scoped to the app (main process) only

**Status:** Accepted

**Context.** §5 requires SQLite (WAL) for history/Spaces/grants/trace indexes.
`better-sqlite3` is a native module; forcing it into every package would make the portable
core packages fail to install on machines without a matching prebuilt binary.

**Decision.** `better-sqlite3` (WAL) lives **only** in `apps/browser` (the Electron main
process), which owns durable local state: history, Spaces, grants ledger index, and trace
index. The engine-agnostic packages persist through injectable stores:
- `@proa/traces` writes **append-only JSONL + a screenshots dir** (per §6) — no DB dependency.
- `@proa/permissions` takes a `LedgerStore` interface; defaults to in-memory / JSONL; the app
  supplies a SQLite-backed implementation.

**Consequence.** Portable core (installs/tests anywhere) *and* a real SQLite state layer in the
shipped app. Trace format stays grep-able and diff-able on disk.

---

## ADR-0005 — Permission decisions live outside the model

**Status:** Accepted

**Decision.** The permission engine is a pure function of (agent, capability, domain, Space,
grant store) — it never consults the model. The agent loop **must** pass every write-action
through `permissions.check()` before dispatching it to the engine. Reads are free; `act:click`,
`act:type`, `act:submit`, `download` require a remembered per-(domain,Space) grant; the
**irreversible class** (payment / auth-change / delete / send) *always* requires a fresh grant
and is never remembered. An injected instruction can make the model *want* anything; the runtime
still refuses. Every allow/deny is appended to the ledger. This is the architectural answer to
the 2026 market's unsolved prompt-injection problem. See `SECURITY.md`.

---

## ADR-0006 — Determinism via MockProvider + DomEngine is the CI backbone

**Status:** Accepted

**Decision.** CI must never need an API key or external network. The `MockProvider` replays a
scripted, deterministic sequence of model decisions; `DomEngine` loads the bundled fixture site
from local HTML. Together they let all five benchmark tasks (login gate, cheapest-product,
multi-page form fill, typed table extraction vs. a golden file, and the **injection-trap
refusal**) run identically every time, locally and in CI. A live provider (Anthropic) is used
only for optional local smoke, never in CI.

---

## ADR-0007 — Execution environment adaptation (build machine)

**Status:** Accepted

**Context.** v0.1 was built on a headless Amazon Linux sandbox: no display, no root, no ability
to install `xvfb`, and (initially) a firewalled npm registry. Electron cannot launch there.

**Decision.** All Electron-dependent verification — app e2e (Playwright-on-Electron),
screenshots, and `.app` packaging — runs in **GitHub Actions** (ubuntu with `xvfb-run` for e2e;
macOS for build, e2e, benchmark, and the packaged artifact). The engine-agnostic packages, the
DomEngine, the SDK/CLI/MCP, and the full benchmark are verified **locally** in the sandbox on
`DomEngine` + `MockProvider`, and again in CI. This mirrors §0.3's headless-Linux guidance,
extended to "no xvfb available locally either." Gaps are logged honestly in `KNOWN_GAPS.md`.

**Consequence.** CI on GitHub is the source of truth for the Electron surface; the sandbox is the
source of truth for the (larger, differentiating) portable surface. Nothing about the product is
faked to accommodate the build machine.
