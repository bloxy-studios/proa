import type {
  AgentAction,
  Capability,
  IrreversibleClass,
  IRNode,
  PageIR,
} from "@proa/protocol";
import { DONE_TOOL, TOOL_BASE_CAPABILITY, findByRef } from "@proa/protocol";

export interface ActionClassification {
  capability: Capability;
  irreversible?: IrreversibleClass;
  /** Accessible name of the target node, for the ledger and prompts. */
  target?: string;
  reason: string;
}

// Patterns that mark an action as belonging to the irreversible class. Matched
// against the target's accessible name (case-insensitive). Kept deliberately broad:
// false positives cost one extra human confirmation; false negatives cost trust.
const IRREVERSIBLE_PATTERNS: { cls: IrreversibleClass; re: RegExp }[] = [
  { cls: "payment", re: /\b(pay|buy|purchase|checkout|place\s+order|add\s+card|subscribe|donate|confirm\s+payment)\b/i },
  { cls: "delete", re: /\b(delete|remove|destroy|erase|deactivate|close\s+account|wipe|drop)\b/i },
  { cls: "send", re: /\b(send|post|publish|share|tweet|submit\s+report|transfer|wire)\b/i },
  { cls: "auth", re: /\b(change\s+password|reset\s+password|sign\s+out|log\s*out|revoke|disable\s+2fa|security\s+settings|add\s+recovery)\b/i },
];

function classifyByName(name: string | undefined): IrreversibleClass | undefined {
  if (!name) return undefined;
  for (const { cls, re } of IRREVERSIBLE_PATTERNS) {
    if (re.test(name)) return cls;
  }
  return undefined;
}

/**
 * Classify an action into the capability it requires, escalating to the
 * irreversible class when the target looks destructive. Purely structural — it
 * never consults the model (ADR-0005).
 */
export function classifyAction(action: AgentAction, ir?: PageIR): ActionClassification {
  if (action.tool === DONE_TOOL) {
    return { capability: "read", reason: "run completion" };
  }
  const base = TOOL_BASE_CAPABILITY[action.tool];
  const ref = typeof action.params.ref === "string" ? action.params.ref : undefined;
  let target: IRNode | undefined;
  if (ref && ir) target = findByRef(ir.root, ref);
  const targetName = target?.name;

  // download of an unknown URL is always gated as download.
  if (action.tool === "download") {
    return { capability: "download", target: targetName, reason: "file download (quarantined)" };
  }

  // Only write-actions can be irreversible.
  const isWrite = base === "act:click" || base === "act:type" || base === "act:submit";
  if (isWrite) {
    const cls = classifyByName(targetName);
    if (cls) {
      return {
        capability: base,
        irreversible: cls,
        target: targetName,
        reason: `irreversible (${cls}) — matched target "${targetName ?? "?"}"`,
      };
    }
  }

  // A form submit (type with submit, or click on a submit-ish control) → act:submit.
  if (action.tool === "type" && action.params.submit === true) {
    return { capability: "act:submit", target: targetName, reason: "type + submit" };
  }
  if (action.tool === "click" && target && isSubmitLike(target)) {
    return { capability: "act:submit", target: targetName, reason: "submit control" };
  }

  return { capability: base, target: targetName, reason: `base capability for ${action.tool}` };
}

function isSubmitLike(node: IRNode): boolean {
  const n = (node.name ?? "").toLowerCase();
  if (node.role === "button" && /\b(submit|continue|next|save|sign\s*in|log\s*in|apply|search)\b/.test(n)) {
    return true;
  }
  return false;
}
