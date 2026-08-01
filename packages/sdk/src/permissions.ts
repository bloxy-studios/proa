import type { Capability } from "@proa/protocol";
import { MemoryLedgerStore, PermissionEngine, denyAll } from "@proa/permissions";

/** Short capability aliases developers pass in `permissions: { "site.com": ["click"] }`. */
const ALIAS: Record<string, Capability> = {
  read: "read",
  click: "act:click",
  type: "act:type",
  select: "act:select",
  submit: "act:submit",
  scroll: "act:scroll",
  download: "download",
};

export type PermissionsSpec = Record<string, string[]>;

export function isPermissionEngine(x: unknown): x is PermissionEngine {
  return x instanceof PermissionEngine;
}

/**
 * Build a PermissionEngine from a simple domain→capabilities map. Pre-grants exactly the
 * listed reversible capabilities (remembered); everything else is denied, and the
 * irreversible class always requires a fresh grant that a headless run cannot provide.
 */
export function engineFromSpec(
  spec: PermissionsSpec,
  agent = "agent",
  space = "default",
): PermissionEngine {
  const store = new MemoryLedgerStore();
  for (const [domain, caps] of Object.entries(spec)) {
    for (const cap of caps) {
      const capability = ALIAS[cap] ?? (cap as Capability);
      store.grant({ agent, capability, domain, space });
    }
  }
  return new PermissionEngine({ store, prompter: denyAll });
}
