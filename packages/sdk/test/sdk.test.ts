import { describe, it, expect } from "vitest";
import { z } from "zod";
import { MockProvider } from "@proa/core";
import { proa, zodToSchemaSpec } from "../src/index.js";

const PRODUCTS = `<!doctype html><html><head><title>Products</title></head><body>
  <table>
    <thead><tr><th>Name</th><th>Price</th><th>In stock</th></tr></thead>
    <tbody>
      <tr><td>Widget</td><td>$12.00</td><td>Yes</td></tr>
      <tr><td>Gadget</td><td>$8.50</td><td>No</td></tr>
    </tbody>
  </table>
</body></html>`;

const resolve = () => PRODUCTS;

describe("zodToSchemaSpec", () => {
  it("converts common zod shapes", () => {
    const spec = zodToSchemaSpec(
      z.array(z.object({ title: z.string(), url: z.string().url(), points: z.number() })).max(5),
    );
    expect(spec).toEqual({
      type: "array",
      max: 5,
      items: {
        type: "object",
        fields: { title: { type: "string" }, url: { type: "string", format: "url" }, points: { type: "number" } },
      },
    });
  });
});

describe("proa.launch (headless)", () => {
  it("extracts typed JSON from a page via a zod schema", async () => {
    const app = await proa.launch({ headless: true, resolve, baseUrl: "https://shop.test" });
    const tab = await app.tabs.open("https://shop.test/products");
    const Product = z.object({ name: z.string(), price: z.number(), inStock: z.boolean() });
    const rows = await tab.extract(z.array(Product).max(10));
    expect(rows).toEqual([
      { name: "Widget", price: 12, inStock: true },
      { name: "Gadget", price: 8.5, inStock: false },
    ]);
    await app.close();
  });

  it("runs an agent, streams steps, and records a trace", async () => {
    const app = await proa.launch({ headless: true, resolve, baseUrl: "https://shop.test" });
    const productSpec = {
      type: "array" as const,
      items: {
        type: "object" as const,
        fields: { name: { type: "string" as const }, price: { type: "number" as const } },
      },
    };
    const run = app.agents.run("extract the products", {
      provider: new MockProvider([
        { thought: "extract", action: { tool: "extract", params: { schema: productSpec } } },
        { thought: "done", action: { tool: "done", params: { summary: "extracted" } } },
      ]),
      permissions: { "shop.test": ["read"] },
      startUrl: "https://shop.test/products",
    });

    const seen: string[] = [];
    for await (const step of run.steps()) seen.push(step.action.tool);
    const outcome = await run.result();

    expect(seen).toContain("extract");
    expect(outcome.status).toBe("completed");
    const data = outcome.artifacts.find((a) => a.kind === "json")?.data as unknown[];
    expect(data.length).toBe(2);
    expect(run.trace().events.some((e) => e.type === "run.end")).toBe(true);
    await app.close();
  });
});
