# Contributing to Proa

Proa is an open-source, agent-native browser for developers. This document is how you get a
working checkout, what the rules are, and where to put a change so it lands in the right layer.

Read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) before your first non-trivial PR — the
package boundaries are load-bearing, and the review will be about whether your change respects
them. [`docs/DECISIONS.md`](./docs/DECISIONS.md) records why things are the way they are; if
you want to change one of those decisions, add a new ADR rather than editing the old one.

---

## 1. Prerequisites

| | |
|---|---|
| **Node** | ≥ 20 (`engines.node` in the root `package.json`) |
| **pnpm** | 10.x — the repo pins `packageManager: "pnpm@10.34.3"`; `corepack enable` is the easy path |
| **Git** | any recent version |
| **macOS** | only needed for the desktop app and `.app` packaging (see §8) |

Everything except the Electron app's *runtime* builds, tests, and runs on any platform with
Node ≥ 20 — no display, no GPU, no API key, no network. That is deliberate (ADR-0001,
ADR-0006). The app itself typechecks anywhere; running, e2e-testing, and packaging it need a
display (§8).

```bash
git clone https://github.com/bloxy-studios/proa
cd proa
pnpm install
pnpm verify
```

---

## 2. The commands

| Command | What it does |
|---|---|
| `pnpm verify` | **lint + typecheck + test + build.** The gate. Must be green before every push. Covers `packages/*`, `benchmark`, and `fixtures/*` — **not** `apps/browser` (§8). |
| `pnpm lint` | `eslint .` |
| `pnpm typecheck` | `tsc -p tsconfig.json --noEmit` across all packages at once |
| `pnpm test` | `vitest run` — unit tests plus the full agent benchmark |
| `pnpm test:watch` | `vitest` in watch mode |
| `pnpm build` | `tsup` for every library in `packages/*`, in topological order |
| `pnpm fixtures` | serve the fixture site on `http://127.0.0.1:4321` (`PORT` overrides) |
| `pnpm bench` | the five-task agent benchmark (alias for the filter below) |
| `pnpm clean` | remove `dist/`, `out/`, build caches |

Run a single package's tests or a single file the usual vitest way:

```bash
pnpm vitest run packages/permissions
pnpm vitest run packages/extractor/test/extractor.test.ts -t "redacts secret fields"
```

### The benchmark

```bash
pnpm bench                                  # or: pnpm --filter @proa/benchmark bench
PROA_BENCH_TRACE_DIR=.proa/traces pnpm bench   # also write each task's trace as JSONL
```

Five deterministic tasks on `MockProvider` + `DomEngine` against the bundled fixture site:
`login`, `cheapest-to-cart`, `multi-page-form`, `extract-table`, and `injection-trap`. It
exits non-zero if any task fails, and it also runs as a vitest suite
(`benchmark/test/benchmark.test.ts`) so `pnpm test` covers it.

**All five green is a merge gate.** `injection-trap` in particular scripts a *deliberately
compromised* agent that tries to obey an injected instruction; it passes only when the sanitizer
flags the bait, the permission engine denies the irreversible delete, and the page never
reaches the deleted state. If your change makes the agent comply, the build goes red — that is
the feature working. See [SECURITY.md](./SECURITY.md) §1.

### The fixture site

`fixtures/testsite` is a single pure function, `resolve(path) → html`, rendering `/`, `/login`,
`/products`, `/cart`, `/form`, `/list`, `/trap`, and `/account`. Because it is pure, the same
site backs both the HTTP server used by Playwright e2e and the in-process `DomEngine` resolver
used by the benchmark — byte-identical pages, zero external-network flakiness.

```bash
pnpm fixtures            # http://127.0.0.1:4321
PORT=5000 pnpm fixtures
```

Add pages here whenever you need new agent behaviour to be testable. Export the data your
assertions need (`PRODUCTS`, `CHEAPEST`, `PROFILE`, `ROUTES`) so tests reference values rather
than string literals.

---

## 3. Monorepo layout

```
apps/browser        desktop shell — Electron main (ChromiumEngine, SQLite) + preload + renderer
packages/protocol   shared contracts — capabilities, tools, Page IR, traces, EngineAdapter
packages/extractor  Page IR distillation + taint sanitizer + schema mapper
packages/permissions capability engine + audit ledger
packages/traces     hash-chained JSONL store, replayer, differ, Playwright exporter
packages/core       engine-agnostic agent runtime — DomEngine, agent loop, model providers
packages/sdk        @proa/sdk
packages/cli        the `proa` binary
packages/mcp        MCP stdio server + HTTP bridge
fixtures/testsite   the bundled fixture site
benchmark           the five-task agent benchmark
examples            runnable task files for `proa run`
docs                ADRs, architecture, demo script
```

Workspace globs are in `pnpm-workspace.yaml`: `packages/*`, `apps/*`, `fixtures/*`, `benchmark`.

Two boundaries are non-negotiable in review:

1. **`packages/core` must never import Electron** (ADR-0001). It talks to the `Engine` /
   `EngineTab` interface in `packages/protocol/src/engine.ts`. If your feature "needs" Electron
   in core, it needs a new method on the adapter instead.
2. **`better-sqlite3` lives only in `apps/browser`** (ADR-0004). It is a native module; forcing
   it into the portable packages would break installation on machines without a matching
   prebuilt binary. The portable packages persist through injectable interfaces —
   `LedgerStore` for grants, plain JSONL for traces.

### How cross-package imports resolve (ADR-0002)

Packages depend on each other with `workspace:*`. For **typecheck, test, and dev**,
`@proa/*` imports resolve directly to **source** via `paths` in `tsconfig.base.json` (and
`vite-tsconfig-paths` for vitest). There is no build step in the inner loop: you can edit
`packages/protocol/src/tools.ts` and immediately run a test in `packages/cli` against it.

For **distribution**, each library builds with `tsup` (ESM + `.d.ts`, `target: node20`)
treating `@proa/*`, `better-sqlite3`, and `electron` as external, and `pnpm build` runs in
topological order so dependencies are built first.

Practical consequence: `pnpm lint && pnpm typecheck && pnpm test` need zero prior build, and
`pnpm build` is only about producing publishable `dist/`.

---

## 4. Working practices

### Conventional commits

`<type>(<scope>): <subject>`, imperative mood, lower case, no trailing period.

```
feat(extractor): flag sr-only elements as hidden
fix(permissions): treat "wire transfer" as the send class
docs(architecture): document the engine boundary
test(benchmark): add a second injection trap page
chore(deps): bump vitest
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `build`, `ci`. Scope is the
package without the `@proa/` prefix (`protocol`, `extractor`, `permissions`, `traces`, `core`,
`sdk`, `cli`, `mcp`, `browser`, `fixtures`, `benchmark`) or a doc area. Small, logical units —
one concern per commit.

### `pnpm verify` must pass before every push

Nothing lands on a red `pnpm verify`. This is the one rule with no exceptions. It is four
things — lint, typecheck, test, build — and it is fast because none of them need a prior build.

For a milestone tag, the e2e smoke must pass too.

### Tests are not optional

Every change to the differentiating logic ships with a test:

- **extractor** — a fixture DOM in `packages/extractor/test/`, plus a fixture-site page if the
  behaviour should also be exercised end-to-end;
- **permissions** — a `classifyAction` case and/or a `PermissionEngine` case;
- **traces** — a chain, replay, diff, or export assertion;
- **agent behaviour** — a `MockProvider` script in `packages/core/test/loop.test.ts` or a
  benchmark task;
- **MCP tool surface** — the golden list in `packages/mcp/test/mcp.test.ts` is intentionally
  exact. Changing it is a deliberate act; update the golden and say so in the commit body.

Prefer deterministic tests: inject `now` (`TraceWriter`, `buildPageIR`, and `runAgent` all take
a clock), inject a `Resolver` instead of hitting the network, and use `MockProvider` instead of
a live model. No test may require an API key or the public internet.

### Style

Prettier (`printWidth: 100`, double quotes, semicolons, trailing commas) and
`typescript-eslint` recommended, with `no-unused-vars` allowing a leading `_`.
TypeScript is strict, including `noUncheckedIndexedAccess` — indexed access yields
`T | undefined` and you must handle it. Public exports carry a doc comment explaining *why*
the thing exists, not what the code already says.

---

## 5. Adding a new agent tool

The parity principle says a verb exists on every surface or it does not exist. Adding one
touches five files, in this order:

1. **`packages/protocol/src/tools.ts`** — add the name to `TOOL_NAMES`, add a zod params
   schema, register it in `TOOL_PARAM_SCHEMAS`, and give it an entry in
   `TOOL_BASE_CAPABILITY`. *Choose the base capability conservatively: it is the floor, and the
   permission engine can only escalate from there.*
2. **`packages/protocol/src/engine.ts`** — if the tool needs to touch the page, add a method to
   `EngineTab`, then implement it in **every** engine: `DomEngine`
   (`packages/core/src/engine/dom-engine.ts`) and `ChromiumEngine`
   (`apps/browser/src/main/engine.ts`). A half-implemented adapter is a broken build, which is
   the intent. Remember that `pnpm verify` does not typecheck the app — run
   `pnpm --filter @proa/browser typecheck` too.
3. **`packages/core/src/agent/loop.ts`** — add a `case` to `dispatch()` returning an
   `ActionResult`. Push an `Artifact` if the tool produces one. Do **not** add a permission
   check here; the gate above `dispatch()` already covers every tool via `classifyAction`.
   Also add the verb to `AGENT_TOOLS_FOR_MODEL` in `providers/prompt.ts` and to the `toolDefs`
   map in `providers/anthropic.ts` if the model should be able to choose it.
4. **`packages/mcp/src/tools.ts` and `session.ts`** — add a `TOOL_DEFS` entry (this changes the
   golden test) and a `dispatch()` case. If it is a write, route it through `gate()` first,
   exactly like `click`/`type`/`select`.
5. **`packages/cli/src/program.ts` and/or `packages/sdk/src/app.ts`** — surface it where it
   makes sense for a human at a terminal or a script.
6. **`apps/browser`** — only if the verb needs a human-facing control. That is four small edits
   in lockstep: the method on `ProaBridge` (`src/shared/types.ts`), the `ipcRenderer.invoke` in
   `src/preload/index.ts`, the `ipcMain.handle` in `src/main/index.ts`, and the UI that calls it
   in `src/renderer/App.tsx`. Agent-only tools need none of this — they reach the page through
   the engine, and the console already renders any step.

Then: a benchmark task or a loop test that exercises it, and a line in the parity matrix in
`docs/ARCHITECTURE.md`.

Adding a **capability** or an **irreversible pattern** is smaller: `capabilities.ts` for the
vocabulary, `permissions/src/classify.ts` for the matching, and a case in
`permissions.test.ts`. Widening the irreversible patterns is a cheap, welcome contribution —
false positives cost one extra confirmation, false negatives cost trust.

---

## 6. Non-goals for v0.1

These are settled. Please do not open PRs relitigating them; open an issue for v0.2+ instead.

- **No new rendering engine and no Chromium fork.** Proa embeds an engine; it does not
  maintain one. Forking is the maintenance treadmill that makes a solo/small-team project
  impossible (ADR-0001).
- **No Chrome extension compatibility** in v0.1. Nothing in the design permanently forecloses
  it, but it is not in scope.
- **No accounts, no sync, no cloud.** Local-first; traces and state never leave the machine.
  Zero telemetry by default.
- **No Windows/Linux packaging polish.** Keep the code portable — no gratuitous platform locks
  — but macOS is the packaged v0.1 target.
- **No monetization, no mobile, no extension store.**
- **No "AI slop" surface area.** No chat-with-page summarizer as the hero feature; that is the
  incumbents' product. The hero features are the runtime, the traces, the permissions, and the
  SDK.

---

## 7. Reporting bugs and security issues

Ordinary bugs: open a GitHub issue with the command you ran, what you expected, what happened,
`proa doctor` output, and — if an agent was involved — the trace id, since
`proa trace replay <id>` makes most agent bugs reproducible in seconds.

**Security vulnerabilities: do not open a public issue.** Follow the responsible-disclosure
process in [SECURITY.md](./SECURITY.md) §5.

---

## 8. CI and the desktop app

CI runs on GitHub Actions and **never requires an API key or external network** — everything
runs against the bundled fixture site on `MockProvider` (ADR-0006).

- **ubuntu** — three required jobs: `verify` (lint · typecheck · test · build), `benchmark`
  (the five agent tasks), and `trace-export-e2e` (record a trace, export it, assert the
  generated spec is real Playwright code). These are the hard gate.
- **macOS** — the `app` job: install, build the packages, typecheck `@proa/browser`, build the
  Electron app, run the Playwright-on-Electron e2e, and upload the screenshots it captures. On
  release tags, the release job also produces the unsigned `.app` zip.

### The Electron shell

`apps/browser` **exists**: Electron main (`ChromiumEngine`, SQLite `AppState`, IPC, the MCP
bridge), a `contextBridge` preload, and a React renderer. See
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) §4.1 for the process model.

What you can do where:

| Command | Where it works |
|---|---|
| `pnpm --filter @proa/browser typecheck` | **anywhere**, including headless Linux. Note the root project excludes `apps/**`, so `pnpm verify` does *not* cover the app — run this yourself before pushing shell changes |
| `pnpm --filter @proa/browser dev` | needs a **display** (macOS-first for v0.1) |
| `pnpm build:app` / `pnpm --filter @proa/browser build` | needs the Electron toolchain; runs in the macOS CI job |
| `pnpm --filter @proa/browser test:e2e` | needs a display; runs in the macOS CI job |
| `pnpm --filter @proa/browser package` | macOS only (unsigned `.app`) |

ADR-0007: v0.1 was built on a headless sandbox with no display and no ability to install
`xvfb`, so **all Electron-dependent verification — app runtime, e2e, screenshots, and packaging
— is produced and verified in CI, not on the build machine.** Two consequences worth knowing
before you file a bug: the e2e suite currently covers the shell only (layout, ⌘T palette, agent
console) and is wired `continue-on-error` in `ci.yml` while it stabilises, and `ChromiumEngine`
has no unit tests yet — it is typechecked. The latter is tracked in
[`KNOWN_GAPS.md`](./KNOWN_GAPS.md), which is the place to look before assuming something is
broken rather than unfinished.

If you have a Mac, `dev` plus the e2e harness is the fastest feedback loop, and please attach
screenshots to PRs that change the UI. If you do not, the engine-agnostic packages are fully
testable locally and are where most of the differentiating logic lives; a `ChromiumEngine` change
you cannot run is still reviewable, because whatever it does must be expressible through the
`Engine` / `EngineTab` interface — if it is not, the boundary is the bug.

Thanks for contributing.
