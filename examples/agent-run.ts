/**
 * Example agent run with streamed steps. With ANTHROPIC_API_KEY set this drives a real
 * model; otherwise it uses a deterministic MockProvider so it still runs offline/in CI.
 *   proa run examples/agent-run.ts
 */
import { proa } from "@proa/sdk";
import { MockProvider, AnthropicProvider } from "@proa/core";
import { resolve } from "@proa/testsite";

const app = await proa.launch({ headless: true, resolve, baseUrl: "https://fixture.test" });

const provider = process.env.ANTHROPIC_API_KEY
  ? new AnthropicProvider()
  : new MockProvider([
      {
        thought: "extract the product table",
        action: {
          tool: "extract",
          params: {
            schema: {
              type: "array",
              items: { type: "object", fields: { name: { type: "string" }, price: { type: "number" } } },
            },
          },
        },
      },
      { thought: "done", action: { tool: "done", params: { summary: "extracted products" } } },
    ]);

const run = app.agents.run("list every product with its price", {
  provider,
  permissions: { "fixture.test": ["read", "click"] },
  startUrl: "https://fixture.test/products",
});

for await (const step of run.steps()) {
  console.log(`• ${step.thought} → ${step.action.tool}(${JSON.stringify(step.action.params).slice(0, 80)})`);
}

const outcome = await run.result();
console.log(`\noutcome: ${outcome.status} — ${outcome.summary}`);
console.log(`trace: ${outcome.traceId} (${run.trace().events.length} events)`);
await app.close();
