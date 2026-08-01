import type { IRNode, PageIR, SchemaSpec } from "@proa/protocol";
import { walkIR } from "@proa/protocol";

export interface MapResult {
  value: unknown;
  /** 0..1 heuristic confidence. Model-assisted mapping (in core) can override. */
  confidence: number;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function toNumber(text: string): number | undefined {
  const cleaned = text.replace(/[, ]/g, "");
  const m = /-?\d+(\.\d+)?/.exec(cleaned);
  if (!m) return undefined;
  let n = Number(m[0]);
  if (/\bk\b|k$/i.test(cleaned) && Math.abs(n) < 1000) n *= 1000;
  return Number.isFinite(n) ? n : undefined;
}

function toBoolean(text: string): boolean {
  return /\b(yes|true|in\s*stock|available|on|enabled|✓|✔)\b/i.test(text.trim());
}

function coerce(text: string, spec: SchemaSpec): unknown {
  const t = text.trim();
  switch (spec.type) {
    case "number":
      return toNumber(t) ?? 0;
    case "boolean":
      return toBoolean(t);
    case "enum":
      return spec.values.find((v) => normalize(v) === normalize(t)) ?? t;
    case "string":
    default:
      return t;
  }
}

function collectByRole(root: IRNode, role: string): IRNode[] {
  const out: IRNode[] = [];
  walkIR(root, (n) => {
    if (n.role === role) out.push(n);
  });
  return out;
}

function firstByRole(root: IRNode, role: string): IRNode | undefined {
  return collectByRole(root, role)[0];
}

function flattenNodes(root: IRNode): IRNode[] {
  const out: IRNode[] = [];
  walkIR(root, (n) => out.push(n));
  return out;
}

// ---- Table path (the deterministic golden-file path) ------------------------

function rowCells(row: IRNode): IRNode[] {
  return (row.children ?? []).filter((c) => c.role === "cell" || c.role === "columnheader");
}

function mapTable(table: IRNode, itemSpec: SchemaSpec, max?: number): unknown[] | undefined {
  if (itemSpec.type !== "object") return undefined;
  const rows = collectByRole(table, "row");
  if (rows.length === 0) return undefined;

  // Header row = first row containing columnheaders, else the first row.
  const headerRow = rows.find((r) => rowCells(r).some((c) => c.role === "columnheader")) ?? rows[0]!;
  const headers = rowCells(headerRow).map((c) => normalize(c.name ?? ""));
  const dataRows = rows.filter((r) => r !== headerRow && rowCells(r).some((c) => c.role === "cell"));

  const fieldKeys = Object.keys(itemSpec.fields);
  // Resolve each field to a column index: header match first, then positional.
  const colFor = new Map<string, number>();
  fieldKeys.forEach((key, i) => {
    const nk = normalize(key);
    let idx = headers.findIndex((h) => h === nk || h.includes(nk) || nk.includes(h));
    if (idx < 0) idx = i < headers.length ? i : -1;
    colFor.set(key, idx);
  });

  const items = dataRows.map((row) => {
    const cells = rowCells(row);
    const obj: Record<string, unknown> = {};
    for (const key of fieldKeys) {
      const idx = colFor.get(key)!;
      const cell = idx >= 0 ? cells[idx] : undefined;
      const spec = itemSpec.fields[key]!;
      const text = cell?.name ?? cell?.value ?? "";
      obj[key] = spec.type === "string" && !text ? "" : coerce(text, spec);
    }
    return obj;
  });

  return typeof max === "number" ? items.slice(0, max) : items;
}

// ---- Repeated-item (list) path ---------------------------------------------

function mapObjectFromSubtree(spec: Extract<SchemaSpec, { type: "object" }>, node: IRNode): unknown {
  const nodes = flattenNodes(node);
  const obj: Record<string, unknown> = {};
  for (const [key, fieldSpec] of Object.entries(spec.fields)) {
    obj[key] = pickField(key, fieldSpec, nodes);
  }
  return obj;
}

function pickField(key: string, spec: SchemaSpec, nodes: IRNode[]): unknown {
  const nk = normalize(key);
  if (spec.type === "string" && spec.format === "url") {
    const link = nodes.find((n) => n.href);
    return link?.href ?? "";
  }
  if (spec.type === "number") {
    // Prefer a node whose name mentions the key, else first numeric text.
    const named = nodes.find((n) => n.name && normalize(n.name).includes(nk) && toNumber(n.name) != null);
    if (named) return toNumber(named.name!) ?? 0;
    const numeric = nodes.find((n) => n.name && toNumber(n.name) != null && n.role !== "link");
    return numeric ? (toNumber(numeric.name!) ?? 0) : 0;
  }
  if (spec.type === "boolean") {
    const hit = nodes.find((n) => n.name && normalize(n.name).includes(nk));
    return hit ? toBoolean(hit.name!) : false;
  }
  // string / enum
  const link = nodes.find((n) => n.role === "link" && n.name);
  const heading = nodes.find((n) => n.role === "heading" && n.name);
  const text = (link ?? heading ?? nodes.find((n) => n.name && n.role === "text"))?.name ?? "";
  return coerce(text, spec);
}

function findRepeatedItems(root: IRNode): IRNode[] {
  // Prefer a list with ≥2 listitems.
  const lists = collectByRole(root, "list");
  for (const list of lists) {
    const items = (list.children ?? []).filter((c) => c.role === "listitem");
    if (items.length >= 2) return items;
  }
  const items = collectByRole(root, "listitem");
  return items;
}

// ---- Public API -------------------------------------------------------------

/**
 * Map Page IR onto a SchemaSpec heuristically. Handles the two shapes that matter for
 * v0.1: array-of-objects (HTML tables → the golden path; repeated list items) and single
 * objects. Returns the coerced value plus a confidence estimate.
 */
export function mapSchema(ir: PageIR, spec: SchemaSpec): MapResult {
  if (spec.type === "array") {
    const itemSpec = spec.items;
    // 1. Table path.
    const table = firstByRole(ir.root, "table");
    if (table && itemSpec.type === "object") {
      const rows = mapTable(table, itemSpec, spec.max);
      if (rows && rows.length > 0) return { value: rows, confidence: 0.95 };
    }
    // 2. Repeated list items.
    if (itemSpec.type === "object") {
      const items = findRepeatedItems(ir.root);
      if (items.length > 0) {
        const mapped = items.map((it) => mapObjectFromSubtree(itemSpec, it));
        const sliced = typeof spec.max === "number" ? mapped.slice(0, spec.max) : mapped;
        return { value: sliced, confidence: 0.7 };
      }
    }
    // 3. Scalar array: collect matching leaf values.
    const leaves: unknown[] = [];
    walkIR(ir.root, (n) => {
      if (!n.name) return;
      if (itemSpec.type === "number") {
        const num = toNumber(n.name);
        if (num != null && n.role !== "link") leaves.push(num);
      } else if (itemSpec.type === "string") {
        if (n.role === "link" || n.role === "listitem" || n.role === "text") leaves.push(n.name);
      }
    });
    const sliced = typeof spec.max === "number" ? leaves.slice(0, spec.max) : leaves;
    return { value: sliced, confidence: leaves.length ? 0.5 : 0.1 };
  }

  if (spec.type === "object") {
    return { value: mapObjectFromSubtree(spec, ir.root), confidence: 0.6 };
  }

  // Top-level scalar.
  const first = flattenNodes(ir.root).find((n) => n.name);
  return { value: first ? coerce(first.name!, spec) : null, confidence: first ? 0.4 : 0.1 };
}
