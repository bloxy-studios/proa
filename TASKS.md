# TASKS — Proa working memory

> Resume the mission from this file + `docs/DECISIONS.md` alone.
> Every session: read this, do work, update the log, keep "Known gaps" honest.

## Handoff / status

- **Repo:** https://github.com/bloxy-studios/proa (public, Apache-2.0)
- **Build machine:** headless Amazon Linux sandbox — no display, no root, no xvfb. Electron cannot
  run here. Portable packages + DomEngine + benchmark verify locally; Electron GUI verifies in CI.
  See ADR-0007.
- **No human input expected.** Decisions recorded as ADRs.

## Milestones

### M0 — Foundation
- [x] Name check → **Proa** (ADR-0000)
- [x] Create public Apache-2.0 repo via authenticated git
- [x] pnpm monorepo scaffold (root config, tsconfig paths, eslint, prettier, vitest)
- [x] ADR-0001..0007
- [ ] CI skeleton green (lint/typecheck/unit on ubuntu; app build/e2e on macOS)
- [ ] `@proa/protocol` shared contracts
- [ ] Tag `v0.1.0-m0`

### M1 — A browser you'd actually use
- [ ] Electron shell: sidebar (Space name, URL pill, pinned favicon grid, vertical tabs)
- [ ] Spaces: create/switch, per-Space session partition, gradient wallpaper (5 presets)
- [ ] Command palette (URL / search / fuzzy tab-switch / `/` commands / `@` agents)
- [ ] History (SQLite WAL), downloads, crash-safe restore, core shortcuts
- [ ] e2e drives fixture site through tabs/Spaces/palette; screenshots
- [ ] Tag `v0.1.0-m1`

### M2 — The developer's browser
- [ ] `@proa/extractor`: Page IR + `extract(schema)` (heuristic + model-assisted)
- [ ] Developer HUD (⌘⇧D): console errors, network summary, CDP endpoint, Page IR viewer
- [ ] Copy as Playwright, Copy page as JSON
- [ ] Golden-file test: fixture product table → typed JSON
- [ ] Tag `v0.1.0-m2`

### M3 — The agent moves in
- [ ] `@proa/core`: EngineAdapter, DomEngine, agent loop, budgets, ModelProvider + MockProvider
- [ ] `@proa/permissions`: capability engine + ledger, irreversible class
- [ ] `@proa/traces`: hash-chained JSONL store, replayer, differ, Playwright exporter
- [ ] Agent console (three-surface layout), ride-along ghost cursor, permission prompts, ledger badge
- [ ] All 5 benchmark tasks green on MockProvider incl. injection trap; replay reproduces actions
- [ ] Tag `v0.1.0-m3`

### M4 — The programmable browser
- [ ] `@proa/sdk`: connect / launch headless, tabs, extract, agents.run streamed steps
- [ ] `@proa/cli`: open, run task.ts --headless --json, trace ls|replay|export --as playwright, mcp serve, doctor
- [ ] `@proa/mcp`: MCP server (stdio + HTTP) mirroring SDK verbs; tool-list golden test
- [ ] README "Drive it from Claude Code"
- [ ] Tag `v0.1.0-m4`

### M5 — Ship it
- [ ] Fixture site polish, both themes, onboarding, empty states, latency pass
- [ ] README hero + 3 demo captures + quickstart; docs/DEMO.md; KNOWN_GAPS.md final
- [ ] Tag **v0.1.0** with macOS artifact (produced by CI release job)

## Session log
- 2026-08-01 — Preflight; picked name Proa; created repo; scaffolded monorepo, ADRs, root config.

## Known gaps (live)
- Electron GUI runtime, app e2e, screenshots, `.app` packaging are produced/verified in CI, not on
  the build machine (ADR-0007). Tracked in `KNOWN_GAPS.md`.

## v0.2 proposal (filled in at Definition of Done)
- TBD
