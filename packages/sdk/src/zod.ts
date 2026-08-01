import type { z } from "zod";
import type { SchemaSpec } from "@proa/protocol";

/**
 * Convert a zod schema to a Proa SchemaSpec. Supports the shapes developers actually use
 * for page extraction: object, array (with `.max()`), string (`.url()`/`.email()`),
 * number, boolean, enum, and optional/nullable/default wrappers.
 */
export function zodToSchemaSpec(schema: z.ZodTypeAny): SchemaSpec {
  const def = schema._def as { typeName: string } & Record<string, unknown>;
  switch (def.typeName) {
    case "ZodString": {
      const checks = (def.checks as { kind: string }[] | undefined) ?? [];
      if (checks.some((c) => c.kind === "url")) return { type: "string", format: "url" };
      if (checks.some((c) => c.kind === "email")) return { type: "string", format: "email" };
      return { type: "string" };
    }
    case "ZodNumber":
      return { type: "number" };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodEnum":
      return { type: "enum", values: [...(def.values as string[])] };
    case "ZodNativeEnum":
      return { type: "enum", values: Object.values(def.values as Record<string, string>) };
    case "ZodArray": {
      const items = zodToSchemaSpec(def.type as z.ZodTypeAny);
      const max = (def.maxLength as { value: number } | null)?.value;
      return max != null ? { type: "array", items, max } : { type: "array", items };
    }
    case "ZodObject": {
      const shape = (def.shape as () => Record<string, z.ZodTypeAny>)();
      const fields: Record<string, SchemaSpec> = {};
      for (const [key, value] of Object.entries(shape)) fields[key] = zodToSchemaSpec(value);
      return { type: "object", fields };
    }
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
      return zodToSchemaSpec(def.innerType as z.ZodTypeAny);
    default:
      throw new Error(`zodToSchemaSpec: unsupported zod type ${def.typeName}`);
  }
}
