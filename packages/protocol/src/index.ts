/**
 * @proa/protocol — the shared contracts every other package imports.
 * Pure types + zod schemas + tiny helpers; no runtime dependencies beyond zod.
 */
export * from "./capabilities.js";
export * from "./tools.js";
export * from "./ir.js";
export * from "./schema.js";
export * from "./traces.js";
export * from "./agent.js";
export * from "./engine.js";

export const PROTOCOL_VERSION = "0.1.0";
