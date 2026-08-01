/**
 * A minimal structural subset of the W3C DOM that both a real `Document`/`Element`
 * (jsdom, and a browser renderer) and a CDP-derived DOM snapshot can satisfy. Keeping
 * the extractor typed against this — rather than jsdom — is what lets the SAME IR code
 * run behind the DomEngine and the ChromiumEngine.
 */

export const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;

export interface DomLikeNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  nodeValue?: string | null;
}

export interface DomLikeElement extends DomLikeNode {
  tagName: string;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  readonly childNodes: ArrayLike<DomLikeNode>;
  readonly children: ArrayLike<DomLikeElement>;
}

export function isElement(n: DomLikeNode): n is DomLikeElement {
  return n.nodeType === ELEMENT_NODE;
}

export function childElements(el: DomLikeElement): DomLikeElement[] {
  const out: DomLikeElement[] = [];
  const kids = el.children;
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    if (c) out.push(c);
  }
  return out;
}

/** Direct (non-recursive) text of an element, excluding text inside child elements. */
export function directText(el: DomLikeElement): string {
  let s = "";
  const nodes = el.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n && n.nodeType === TEXT_NODE) s += n.nodeValue ?? n.textContent ?? "";
  }
  return s.replace(/\s+/g, " ").trim();
}

export function collapse(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}
