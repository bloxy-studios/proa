import type { AgentAction, Capability, IrreversibleClass, PageIR } from "@proa/protocol";
import { isFreeCapability } from "@proa/protocol";
import { classifyAction } from "./classify.js";
import type { GrantKey, LedgerEntry, LedgerStore } from "./ledger.js";
import { MemoryLedgerStore } from "./ledger.js";

export interface PermissionRequest {
  agent: string;
  space: string;
  domain: string;
  capability: Capability;
  irreversible?: IrreversibleClass;
  target?: string;
  reason: string;
}

/**
 * Asks a human to approve a capability. Returns true to allow. In headless mode a
 * prompter typically denies (or returns via askHuman → needs-human). Never called
 * for free capabilities.
 */
export type Prompter = (req: PermissionRequest) => Promise<boolean>;

export interface PermissionDecision {
  allowed: boolean;
  capability: Capability;
  irreversible?: IrreversibleClass;
  remembered: boolean;
  reason: string;
  entry: LedgerEntry;
}

export interface CheckArgs {
  agent: string;
  space: string;
  /** The page's domain (host). */
  domain: string;
  action: AgentAction;
  ir?: PageIR;
}

export interface PermissionEngineOptions {
  store?: LedgerStore;
  prompter?: Prompter;
}

/** Convenience prompters. */
export const allowAll: Prompter = async () => true;
export const denyAll: Prompter = async () => false;
/** Allows remembered/simple write grants but always denies the irreversible class. */
export const allowReversibleOnly: Prompter = async (req) => !req.irreversible;

export function domainOf(url: string): string {
  try {
    return new URL(url).host || "local";
  } catch {
    return "local";
  }
}

/**
 * The permission engine. A pure function of (agent, capability, domain, space, store)
 * plus a human prompter for ungranted write-actions. It never consults the model.
 */
export class PermissionEngine {
  readonly store: LedgerStore;
  private prompter: Prompter;

  constructor(opts: PermissionEngineOptions = {}) {
    this.store = opts.store ?? new MemoryLedgerStore();
    this.prompter = opts.prompter ?? denyAll;
  }

  setPrompter(p: Prompter): void {
    this.prompter = p;
  }

  async check(args: CheckArgs): Promise<PermissionDecision> {
    const { agent, space, domain, action, ir } = args;
    const cls = classifyAction(action, ir);
    const capability = cls.capability;
    const key: GrantKey = { agent, capability, domain, space };

    const log = (decision: "allow" | "deny", remembered: boolean, reason: string) => {
      const entry = this.store.append({
        agent,
        space,
        domain,
        tool: action.tool,
        capability,
        decision,
        remembered,
        irreversible: cls.irreversible,
        target: cls.target,
        reason,
      });
      return {
        allowed: decision === "allow",
        capability,
        irreversible: cls.irreversible,
        remembered,
        reason,
        entry,
      } satisfies PermissionDecision;
    };

    // 1. Observation & scrolling are always free — no grant, no prompt.
    if (isFreeCapability(capability) && !cls.irreversible) {
      return log("allow", false, "free capability (observation)");
    }

    // 2. Irreversible class ALWAYS prompts fresh and is never remembered.
    if (cls.irreversible) {
      const ok = await this.prompter({
        agent,
        space,
        domain,
        capability,
        irreversible: cls.irreversible,
        target: cls.target,
        reason: cls.reason,
      });
      return log(
        ok ? "allow" : "deny",
        false,
        ok
          ? `fresh human grant for irreversible ${cls.irreversible}`
          : `denied irreversible ${cls.irreversible} (no fresh grant)`,
      );
    }

    // 3. Remembered write grant for this (agent, capability, domain, space)?
    if (this.store.hasGrant(key)) {
      return log("allow", true, "remembered grant for this Space");
    }

    // 4. Otherwise ask the human once; remember on approval.
    const ok = await this.prompter({
      agent,
      space,
      domain,
      capability,
      target: cls.target,
      reason: cls.reason,
    });
    if (ok) {
      this.store.grant(key);
      return log("allow", true, "human granted (remembered for this Space)");
    }
    return log("deny", false, "human denied");
  }

  ledgerFor(domain: string, space?: string): LedgerEntry[] {
    return this.store.list(space ? { domain, space } : { domain });
  }
}
