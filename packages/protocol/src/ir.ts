/**
 * Page IR — the accessibility-first intermediate representation an agent perceives
 * and acts on. Agents reference stable `ref` ids, never brittle CSS selectors (ADR-0003).
 */

export interface IRNodeState {
  disabled?: boolean;
  checked?: boolean;
  expanded?: boolean;
  selected?: boolean;
  required?: boolean;
  /** true when the field/value is redacted (password/secret) and never serialized. */
  secret?: boolean;
  hidden?: boolean;
}

export interface IRNode {
  /** Stable, deterministic reference (e.g. "n12"). Agents act on this. */
  ref: string;
  /** ARIA-style role: button, link, textbox, heading, listitem, row, cell, text, region, ... */
  role: string;
  /** Accessible name / visible text (redacted if secret). */
  name?: string;
  /** Input value (redacted to "•••" if secret). */
  value?: string;
  /** Heading level, list depth, etc. */
  level?: number;
  href?: string;
  state?: IRNodeState;
  /** Marked when content looks like injected instructions / hidden bait. */
  tainted?: boolean;
  taintReasons?: string[];
  children?: IRNode[];
}

export interface PageIR {
  url: string;
  title: string;
  /** ISO timestamp of capture. */
  capturedAt: string;
  root: IRNode;
  nodeCount: number;
  /** true if any descendant is tainted. */
  tainted: boolean;
}

/** Depth-first walk over an IR tree. */
export function walkIR(node: IRNode, visit: (n: IRNode) => void): void {
  visit(node);
  for (const c of node.children ?? []) walkIR(c, visit);
}

/** Find the first node matching a predicate (depth-first). */
export function findNode(
  root: IRNode,
  pred: (n: IRNode) => boolean,
): IRNode | undefined {
  let found: IRNode | undefined;
  walkIR(root, (n) => {
    if (!found && pred(n)) found = n;
  });
  return found;
}

/** Look up a node by its stable ref. */
export function findByRef(root: IRNode, ref: string): IRNode | undefined {
  return findNode(root, (n) => n.ref === ref);
}
