import { describe, it, expect } from "vitest";
import { ProaSession, TOOL_DEFS, createBridge } from "../src/index.js";

const PRODUCTS = `<!doctype html><html><head><title>Products</title></head><body>
  <table><thead><tr><th>Name</th><th>Price</th></tr></thead>
  <tbody><tr><td>Widget</td><td>12</td></tr><tr><td>Gadget</td><td>8</td></tr></tbody></table>
  <form action="/account"><button type="submit">Delete account</button></form>
</body></html>`;

function session() {
  return new ProaSession({ resolve: () => PRODUCTS, baseUrl: "https://shop.test" });
}

describe("MCP tool list (golden)", () => {
  it("exposes the exact, stable set of tools", () => {
    const names = TOOL_DEFS.map((t) => t.name);
    expect(names).toEqual([
      "ping",
      "tabs.open",
      "tabs.close",
      "tabs.list",
      "navigate",
      "ir",
      "click",
      "type",
      "select",
      "scroll",
      "waitFor",
      "extract",
      "screenshot",
      "download",
      "agent.run",
      "agent.stop",
      "ledger",
    ]);
  });

  it("each tool documents its params and required flags", () => {
    const extract = TOOL_DEFS.find((t) => t.name === "extract")!;
    expect(extract.params.schema!.required).toBe(true);
    const navigate = TOOL_DEFS.find((t) => t.name === "navigate")!;
    expect(navigate.params.url!.required).toBe(true);
  });
});

describe("ProaSession", () => {
  it("navigates and extracts typed data", async () => {
    const s = session();
    const { result } = await s.call("tabs.open", { url: "https://shop.test/products" });
    const tabId = (result as { tabId: string }).tabId;
    const ex = await s.call("extract", {
      tabId,
      schema: { type: "array", items: { type: "object", fields: { name: { type: "string" }, price: { type: "number" } } } },
    });
    expect(ex.ok).toBe(true);
    expect((ex.result as { value: unknown[] }).value).toEqual([
      { name: "Widget", price: 12 },
      { name: "Gadget", price: 8 },
    ]);
    await s.close();
  });

  it("enforces the irreversible-class block over MCP", async () => {
    const s = session();
    const open = await s.call("tabs.open", { url: "https://shop.test/products" });
    const tabId = (open.result as { tabId: string }).tabId;
    const ir = await s.call("ir", { tabId });
    // find the delete button ref
    const findBtn = (n: { role: string; name?: string; ref: string; children?: unknown[] }): string | undefined => {
      if (n.role === "button" && (n.name ?? "").includes("Delete")) return n.ref;
      for (const c of (n.children ?? []) as typeof n[]) {
        const r = findBtn(c);
        if (r) return r;
      }
      return undefined;
    };
    const ref = findBtn((ir.result as { root: Parameters<typeof findBtn>[0] }).root);
    const click = await s.call("click", { tabId, ref });
    expect(click.ok).toBe(false);
    expect(click.error).toMatch(/permission-denied.*delete/i);
    await s.close();
  });
});

describe("HTTP bridge", () => {
  it("answers tool calls over HTTP with bearer auth", async () => {
    const s = session();
    const server = createBridge(s, { token: "secret" });
    await new Promise<void>((r) => server.listen(0, r));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const base = `http://127.0.0.1:${port}`;

    const unauthorized = await fetch(`${base}/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: "ping" }),
    });
    expect(unauthorized.status).toBe(401);

    const ok = await fetch(`${base}/call`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer secret" },
      body: JSON.stringify({ tool: "ping" }),
    });
    const body = (await ok.json()) as { ok: boolean; result: { pong: boolean } };
    expect(body.ok).toBe(true);
    expect(body.result.pong).toBe(true);

    server.close();
    await s.close();
  });
});
