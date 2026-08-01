import type { DomLikeElement } from "./dom.js";
import { collapse, directText } from "./dom.js";

const TAG_ROLE: Record<string, string> = {
  a: "link",
  button: "button",
  nav: "navigation",
  main: "main",
  header: "banner",
  footer: "contentinfo",
  form: "form",
  section: "region",
  article: "article",
  aside: "complementary",
  ul: "list",
  ol: "list",
  li: "listitem",
  table: "table",
  thead: "rowgroup",
  tbody: "rowgroup",
  tr: "row",
  td: "cell",
  th: "columnheader",
  img: "img",
  select: "combobox",
  textarea: "textbox",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  p: "text",
  label: "text",
  option: "option",
};

const INPUT_TYPE_ROLE: Record<string, string> = {
  text: "textbox",
  email: "textbox",
  search: "searchbox",
  url: "textbox",
  tel: "textbox",
  number: "spinbutton",
  password: "textbox",
  checkbox: "checkbox",
  radio: "radio",
  submit: "button",
  button: "button",
  reset: "button",
  range: "slider",
};

export const SKIP_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "head",
  "meta",
  "link",
  "base",
  "br",
  "hr",
]);

export function roleOf(el: DomLikeElement): string {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit.trim().toLowerCase();
  const tag = el.tagName.toLowerCase();
  if (tag === "input") {
    const t = (el.getAttribute("type") ?? "text").toLowerCase();
    return INPUT_TYPE_ROLE[t] ?? "textbox";
  }
  return TAG_ROLE[tag] ?? "generic";
}

export function headingLevel(el: DomLikeElement): number | undefined {
  const tag = el.tagName.toLowerCase();
  const m = /^h([1-6])$/.exec(tag);
  if (m) return Number(m[1]);
  const aria = el.getAttribute("aria-level");
  if (aria && /^\d+$/.test(aria)) return Number(aria);
  return undefined;
}

const INTERACTIVE_ROLES = new Set([
  "link",
  "button",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
  "spinbutton",
  "slider",
  "option",
]);

const STRUCTURAL_ROLES = new Set([
  "navigation",
  "main",
  "banner",
  "contentinfo",
  "form",
  "region",
  "article",
  "complementary",
  "list",
  "listitem",
  "table",
  "row",
  "cell",
  "columnheader",
  "heading",
  "img",
  "search",
]);

export function isInteractive(role: string): boolean {
  return INTERACTIVE_ROLES.has(role);
}

export function isInteresting(role: string, hasText: boolean): boolean {
  if (INTERACTIVE_ROLES.has(role)) return true;
  if (STRUCTURAL_ROLES.has(role)) return true;
  if (role === "text" && hasText) return true;
  return false;
}

/** Build a map of element id -> associated <label> text (for accessible names of inputs). */
export function collectLabels(root: DomLikeElement): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (el: DomLikeElement): void => {
    if (el.tagName.toLowerCase() === "label") {
      const forId = el.getAttribute("for");
      const text = collapse(el.textContent);
      if (forId && text) map.set(forId, text);
    }
    const kids = el.children;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      if (c) walk(c);
    }
  };
  walk(root);
  return map;
}

export function accessibleName(
  el: DomLikeElement,
  role: string,
  labels: Map<string, string>,
): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return collapse(aria);

  const tag = el.tagName.toLowerCase();
  if (tag === "img") return collapse(el.getAttribute("alt") ?? "");

  if (role === "textbox" || role === "searchbox" || role === "combobox" || role === "spinbutton") {
    const id = el.getAttribute("id");
    if (id && labels.has(id)) return labels.get(id)!;
    const ph = el.getAttribute("placeholder");
    if (ph) return collapse(ph);
    const nm = el.getAttribute("name");
    if (nm) return collapse(nm);
    return "";
  }

  // For interactive/structural leaves, prefer full text content; else direct text.
  const full = collapse(el.textContent);
  if (full && full.length <= 200) return full;
  const dt = directText(el);
  if (dt) return dt.slice(0, 200);
  return full.slice(0, 200);
}
