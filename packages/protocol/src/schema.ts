/**
 * SchemaSpec — a small, serializable schema description language that the extractor
 * maps Page IR onto. The SDK converts a user's zod schema into a SchemaSpec; MCP/CLI
 * accept SchemaSpec (or JSON Schema converted to it). This keeps `@proa/extractor`
 * free of any dependency on how the caller expressed the schema.
 */

export type SchemaSpec =
  | { type: "string"; description?: string; format?: "url" | "email" }
  | { type: "number"; description?: string }
  | { type: "boolean"; description?: string }
  | { type: "enum"; values: string[]; description?: string }
  | { type: "array"; items: SchemaSpec; max?: number; description?: string }
  | { type: "object"; fields: Record<string, SchemaSpec>; description?: string };

export function isObjectSpec(
  s: SchemaSpec,
): s is Extract<SchemaSpec, { type: "object" }> {
  return s.type === "object";
}

export function isArraySpec(
  s: SchemaSpec,
): s is Extract<SchemaSpec, { type: "array" }> {
  return s.type === "array";
}
