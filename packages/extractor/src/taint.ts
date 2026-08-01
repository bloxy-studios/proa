import type { DomLikeElement } from "./dom.js";
import { collapse } from "./dom.js";

/**
 * The IR sanitizer. Page-derived content is data, never instructions — but a hostile
 * page may hide imperative bait in off-screen / aria-hidden / display:none nodes to
 * smuggle instructions into model context. We detect hidden-ness and flag suspicious
 * imperative patterns as tainted so the runtime and the model can treat them as such.
 */

export interface HiddenInfo {
  hidden: boolean;
  reasons: string[];
}

export function detectHidden(el: DomLikeElement): HiddenInfo {
  const reasons: string[] = [];
  if (el.hasAttribute("hidden")) reasons.push("hidden-attr");
  if ((el.getAttribute("aria-hidden") ?? "").toLowerCase() === "true") reasons.push("aria-hidden");
  if ((el.getAttribute("type") ?? "").toLowerCase() === "hidden") reasons.push("type-hidden");

  const style = (el.getAttribute("style") ?? "").toLowerCase();
  if (/display\s*:\s*none/.test(style)) reasons.push("display-none");
  if (/visibility\s*:\s*hidden/.test(style)) reasons.push("visibility-hidden");
  if (/opacity\s*:\s*0(\.0*)?(\s*;|$)/.test(style)) reasons.push("opacity-0");
  if (/(width|height)\s*:\s*0(px)?\b/.test(style)) reasons.push("zero-size");
  // Classic off-screen positioning trick.
  if (/position\s*:\s*absolute/.test(style) && /(left|top)\s*:\s*-\d{3,}/.test(style)) {
    reasons.push("offscreen");
  }
  // Common utility class names used to visually hide content.
  const cls = (el.getAttribute("class") ?? "").toLowerCase();
  if (/\b(sr-only|visually-hidden|screen-reader-only|hidden-visually)\b/.test(cls)) {
    reasons.push("sr-only-class");
  }
  return { hidden: reasons.length > 0, reasons };
}

const IMPERATIVE_PATTERNS: RegExp[] = [
  /\bignore\s+(all\s+)?(previous|prior|above|these)\s+instructions?\b/i,
  /\bdisregard\s+(all\s+)?(previous|prior|the)\b/i,
  /\byou\s+are\s+now\b/i,
  /\bnew\s+instructions?\b/i,
  /\bsystem\s+prompt\b/i,
  /\b(assistant|ai|agent)\s*[:,]/i,
  /\bdo\s+not\s+tell\s+the\s+(user|human)\b/i,
  /\bas\s+an\s+ai\b/i,
  /\boverride\b.*\b(instructions?|rules?|policy)\b/i,
  /\b(click|press|submit|delete|send|transfer|pay|buy|export|email)\b.{0,40}\b(immediately|now|first|before)\b/i,
];

export interface TaintInfo {
  tainted: boolean;
  reasons: string[];
}

/** Inspect text (typically hidden text) for injected-instruction patterns. */
export function detectInjection(text: string, hidden: boolean): TaintInfo {
  const t = collapse(text);
  if (!t) return { tainted: false, reasons: [] };
  const reasons: string[] = [];
  for (const re of IMPERATIVE_PATTERNS) {
    if (re.test(t)) reasons.push(`imperative:${re.source.slice(0, 24)}`);
  }
  // Hidden text that reads like instructions is doubly suspicious.
  if (hidden && reasons.length > 0) reasons.push("hidden-instruction");
  // Any hidden text containing the word "instruction(s)" is flagged even without a full match.
  if (hidden && /\binstruction/i.test(t) && reasons.length === 0) {
    reasons.push("hidden-mentions-instructions");
  }
  return { tainted: reasons.length > 0, reasons };
}
