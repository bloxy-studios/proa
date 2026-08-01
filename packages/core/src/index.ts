/**
 * @proa/core — the engine-agnostic agent runtime. Speaks to an EngineAdapter (never to
 * Electron directly). Ships the DomEngine (jsdom, headless), the agent loop, budgets, and
 * the three model providers (Anthropic first-class, OpenAI-compatible, and MockProvider —
 * the deterministic CI backbone).
 */
export * from "./engine/dom-engine.js";
export * from "./providers/mock.js";
export * from "./providers/anthropic.js";
export * from "./providers/openai.js";
export * from "./providers/prompt.js";
export * from "./agent/loop.js";
export * from "./ids.js";

// Re-export the extractor's typed-extraction entry so callers get one import surface.
export { buildPageIR, mapSchema } from "@proa/extractor";
