/**
 * Capability model. Observation is free; write-actions require grants; the
 * irreversible class always requires a fresh human grant (see SECURITY.md).
 */

export const CAPABILITIES = [
  "read",
  "act:click",
  "act:type",
  "act:select",
  "act:scroll",
  "act:submit",
  "download",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Free capabilities never require a grant. */
export const FREE_CAPABILITIES: readonly Capability[] = ["read", "act:scroll"];

/**
 * The irreversible class. Actions classified into any of these ALWAYS require a
 * fresh, per-action human grant and are never remembered.
 */
export const IRREVERSIBLE_CLASSES = ["payment", "auth", "delete", "send"] as const;
export type IrreversibleClass = (typeof IRREVERSIBLE_CLASSES)[number];

export function isFreeCapability(cap: Capability): boolean {
  return FREE_CAPABILITIES.includes(cap);
}
