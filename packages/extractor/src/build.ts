import type { IRNode, PageIR } from "@proa/protocol";
import type { DomLikeElement } from "./dom.js";
import { childElements, collapse, directText } from "./dom.js";
import {
  SKIP_TAGS,
  accessibleName,
  collectLabels,
  headingLevel,
  isInteresting,
  roleOf,
} from "./roles.js";
import { detectHidden, detectInjection } from "./taint.js";

export interface BuildMeta {
  url: string;
  title: string;
  now?: () => string;
  /**
   * Called for every emitted IR node with the DOM element it came from. Engines use
   * this to build a ref -> element map so agents can act on stable refs, not selectors.
   */
  onNode?: (ref: string, el: DomLikeElement) => void;
}

const SECRET_NAME_RE = /pass(word)?|secret|token|api[-_]?key|cvv|card[-_]?number|ssn|otp/i;
const SECRET_VALUE_RE =
  /(sk-[A-Za-z0-9]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|[A-Fa-f0-9]{32,})/;

function isSecretField(el: DomLikeElement): boolean {
  if ((el.getAttribute("type") ?? "").toLowerCase() === "password") return true;
  const hay = `${el.getAttribute("name") ?? ""} ${el.getAttribute("id") ?? ""} ${
    el.getAttribute("autocomplete") ?? ""
  }`;
  return SECRET_NAME_RE.test(hay);
}

function readValue(el: DomLikeElement, role: string, secret: boolean): string | undefined {
  if (role === "checkbox" || role === "radio") {
    return el.hasAttribute("checked") ? "checked" : "unchecked";
  }
  const v = el.getAttribute("value");
  if (v == null) return undefined;
  if (secret) return "•••";
  if (SECRET_VALUE_RE.test(v)) return "[redacted secret]";
  return collapse(v);
}

/**
 * Distill a DOM tree into Page IR — accessibility-first, token-frugal, secret-redacting,
 * and injection-flagging. Deterministic: refs are assigned in emission order ("n0", "n1"…),
 * so the same DOM always yields the same IR (stable for replay).
 */
export function buildPageIR(root: DomLikeElement, meta: BuildMeta): PageIR {
  const labels = collectLabels(root);
  const now = meta.now ?? (() => new Date().toISOString());
  let counter = 0;
  let anyTainted = false;
  let nodeCount = 0;

  const nextRef = (): string => `n${counter++}`;

  // Emit the interesting descendants of `el` as a flat list (flattening generic wrappers).
  const emitChildren = (el: DomLikeElement): IRNode[] => {
    const out: IRNode[] = [];
    for (const child of childElements(el)) {
      const tag = child.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;
      const node = emit(child);
      if (node === "flatten") {
        out.push(...emitChildren(child));
      } else if (node) {
        out.push(node);
      }
    }
    return out;
  };

  const flagged = (el: DomLikeElement, role: string, reasons: string[]): IRNode => {
    anyTainted = true;
    nodeCount++;
    const ref = nextRef();
    meta.onNode?.(ref, el);
    // Surface the bait as a flagged, REDACTED node — its literal instruction text
    // never enters the IR (and thus never enters model context) as clean content.
    return {
      ref,
      role: role === "generic" ? "text" : role,
      name: "[tainted content withheld]",
      tainted: true,
      taintReasons: reasons,
    };
  };

  // Returns an IRNode, "flatten" (recurse without emitting), or null (drop).
  const emit = (el: DomLikeElement): IRNode | "flatten" | null => {
    const role = roleOf(el);
    const hidden = detectHidden(el);

    // Hidden subtree: inspect its FULL text for injected instructions. If it's bait,
    // surface a flagged/redacted node; otherwise drop it entirely (token-frugal, and it
    // never reaches model context either way). We do NOT flag on aggregate text for
    // VISIBLE elements — that would over-flag every ancestor of any hidden bait.
    if (hidden.hidden) {
      const inj = detectInjection(collapse(el.textContent), true);
      if (inj.tainted) {
        const node = flagged(el, role, [...inj.reasons, ...hidden.reasons]);
        node.state = { hidden: true };
        return node;
      }
      return null;
    }

    // Visible element: only its OWN direct text can taint it.
    const dt = directText(el);
    const injection = detectInjection(dt, false);
    if (injection.tainted) {
      const node = flagged(el, role, injection.reasons);
      const children = emitChildren(el);
      if (children.length > 0) node.children = children;
      return node;
    }

    const hasText = dt.length > 0;
    if (!isInteresting(role, hasText)) {
      return "flatten";
    }

    const secret = role === "textbox" && isSecretField(el);
    const name = accessibleName(el, role, labels);
    const value = readValue(el, role, secret);

    const state: NonNullable<IRNode["state"]> = {};
    if (el.hasAttribute("disabled")) state.disabled = true;
    if (el.hasAttribute("required")) state.required = true;
    if (role === "checkbox" || role === "radio") state.checked = el.hasAttribute("checked");
    const expanded = el.getAttribute("aria-expanded");
    if (expanded != null) state.expanded = expanded === "true";
    const selected = el.getAttribute("aria-selected");
    if (selected != null) state.selected = selected === "true";
    if (secret) state.secret = true;

    const ref = nextRef();
    meta.onNode?.(ref, el);
    const node: IRNode = { ref, role };
    if (name) node.name = name;
    if (value !== undefined) node.value = value;
    const lvl = headingLevel(el);
    if (lvl) node.level = lvl;
    const href = el.getAttribute("href");
    if (href) node.href = href;
    if (Object.keys(state).length > 0) node.state = state;

    nodeCount++;
    const children = emitChildren(el);
    if (children.length > 0) node.children = children;
    return node;
  };

  const rootNode: IRNode = {
    ref: nextRef(),
    role: "document",
    name: meta.title || undefined,
    children: emitChildren(root),
  };
  nodeCount++;

  return {
    url: meta.url,
    title: meta.title,
    capturedAt: now(),
    root: rootNode,
    nodeCount,
    tainted: anyTainted,
  };
}
