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

  // Returns an IRNode, "flatten" (recurse without emitting), or null (drop).
  const emit = (el: DomLikeElement): IRNode | "flatten" | null => {
    const role = roleOf(el);
    const hidden = detectHidden(el);

    const text = collapse(el.textContent);
    const injection = detectInjection(text, hidden.hidden);
    if (injection.tainted) {
      anyTainted = true;
      nodeCount++;
      // Surface the bait as a flagged, REDACTED node — its literal instruction text
      // never enters the IR (and thus never enters model context) as clean content.
      return {
        ref: nextRef(),
        role: "text",
        name: "[tainted content withheld]",
        tainted: true,
        taintReasons: [...injection.reasons, ...hidden.reasons],
        state: hidden.hidden ? { hidden: true } : undefined,
      };
    }

    // Non-tainted hidden content is simply dropped (not interesting, token-frugal).
    if (hidden.hidden) return null;

    const dt = directText(el);
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

    const node: IRNode = { ref: nextRef(), role };
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
