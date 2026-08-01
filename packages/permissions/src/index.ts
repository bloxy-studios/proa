/**
 * @proa/permissions — capability engine + ledger. The architectural answer to
 * prompt injection: an injected instruction can make the model WANT anything; the
 * runtime still refuses non-granted capabilities, and the irreversible class always
 * requires a fresh human grant (ADR-0005, SECURITY.md).
 */
export * from "./classify.js";
export * from "./ledger.js";
export * from "./engine.js";
