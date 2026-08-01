# TASKS — Proa working memory

> Resume the mission from this file + `docs/DECISIONS.md` alone.

## Status

- **Repo:** https://github.com/bloxy-studios/proa (public, Apache-2.0)
- **Build machine:** headless Linux sandbox — no display/root/xvfb. Engine-agnostic surface +
  benchmark verified locally; Electron GUI verified in CI (ADR-0007, KNOWN_GAPS.md).
- **Local verify:** `pnpm verify` green (lint + typecheck + 39 unit tests + build). Benchmark 5/5.

## Milestones

### M0 — Foundation ✅
- [x] Name → **Proa** (ADR-0000); public Apache-2.0 repo; pnpm monorepo; ADR-0001..0007
- [x] `@proa/protocol` shared contracts; CI skeleton (`.github/workflows/ci.yml`)

### M1 — A browser you'd actually use ✅ (GUI runtime verified in CI)
- [x] Electron shell: three-surface layout (sidebar / web card / agent console)
- [x] Sidebar: Space switcher, URL pill + ledger badge, pinned grid, vertical tabs
- [x] Spaces: create/switch, per-Space `session.fromPartition`, 5 gradient presets
- [x] Command palette (⌘T): URL / search / fuzzy tab-switch / `/` commands / `@` agents
- [x] History + grants + trace index in SQLite (WAL); core shortcuts; dark/light themes
- [x] Playwright-on-Electron e2e drives the shell + captures screenshots (CI)

### M2 — The developer's browser ✅
- [x] `@proa/extractor`: Page IR + taint sanitizer + `extract(schema)` heuristic mapper
- [x] Developer HUD (⌘⇧D): Page IR viewer, network summary, Copy page as JSON, Copy as Playwright
- [x] Golden-file test: fixture product table → typed JSON

### M3 — The agent moves in ✅
- [x] `@proa/core`: EngineAdapter, DomEngine (jsdom), agent loop, budgets, MockProvider/Anthropic/OpenAI
- [x] `@proa/permissions`: capability engine + ledger, irreversible class (outside the model)
- [x] `@proa/traces`: hash-chained JSONL, replay, diff, Playwright export
- [x] Agent console + ride-along ghost cursor + permission prompts + ledger badge (app)
- [x] All 5 benchmark tasks green on MockProvider incl. the injection trap; replay is deterministic

### M4 — The programmable browser ✅
- [x] `@proa/sdk`: launch headless / connect, tabs, typed extract, agents.run streamed steps
- [x] `@proa/cli`: doctor, run, trace ls/replay/export --as playwright, mcp serve, open
- [x] `@proa/mcp`: stdio MCP server + HTTP bridge; golden tool-list; irreversible enforced over MCP
- [x] README "Drive it from Claude Code"; example task files run headless and emit JSON

### M5 — Ship it ✅
- [x] Fixture site (login/form/table/pagination/injection); both themes; empty states
- [x] README (hero + palette + HUD captures + quickstart + non-goals + MCP section)
- [x] ARCHITECTURE, SECURITY, DECISIONS, CONTRIBUTING, DEMO, KNOWN_GAPS
- [x] Milestone tags; **v0.1.0** release created. App builds + e2e green on macOS CI; distributable
      .app packaging (electron-builder) deferred to v0.2 and logged (KNOWN_GAPS, ADR-0007).

## Session log
- 2026-08-01 — Full build in one session: scaffold + all 8 packages + fixture + benchmark +
  Electron app + CI + docs + screenshots. `pnpm verify` green; benchmark 5/5; app typechecks.
  Tagged milestones and cut v0.1.0.

## v0.2 proposal (three highest-leverage next bets)
1. **Trace-diffing UI + session→test polish.** The trace store already diffs and exports; surfacing
   a visual run-vs-run diff in the app turns "did my prompt change break the agent?" into a reviewable
   PR artifact — the single most defensible feature vs. every incumbent.
2. **Model-assisted extraction + a wider injection red-team.** Wire the provider into `extract()` for
   schema mapping when a key is present (heuristic stays the fallback), and expand the trap suite to a
   scored injection benchmark — leaning harder into "the browser you can give credentials to."
3. **Real download quarantine + full MCP streamable-HTTP.** Close the two most-cited gaps: write
   quarantined downloads to disk behind the grant, and add the standard MCP streamable-HTTP transport
   alongside the JSON bridge so remote MCP clients get first-class ride-along.

## Final summary
Proa v0.1 ships an agent-native browser for developers as a public Apache-2.0 monorepo:
a working Electron desktop shell (three-surface UI, Spaces, command palette, Dev HUD, ride-along
ghost cursor, ledger badge) over an **engine-agnostic** TypeScript core. The differentiators are
real and tested in pure Node: typed page extraction (Page IR → schema), a permission engine that
lives **outside the model** with an always-fresh-grant irreversible class, hash-chained traces that
replay/diff/export to runnable Playwright tests, and a browser-as-MCP-server so Claude Code can drive
visible tabs. A deterministic 5-task benchmark — including a prompt-injection trap the build fails on
if the agent complies — runs on MockProvider with no key or network. Honestly gapped: the Electron
runtime/e2e/packaging are CI-verified (the headless build machine can't run a GUI), and a few
features are stubbed (download bytes, model-assisted mapping, MCP streamable-HTTP) — all logged in
KNOWN_GAPS.md. What's here is real, verifiable, and the thing the incumbents can't offer: not a
smarter sidebar — the environment.
