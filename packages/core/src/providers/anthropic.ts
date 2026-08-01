import type { AgentAction, ModelContext, ModelDecision, ModelProvider, ToolName } from "@proa/protocol";
import { DONE_TOOL } from "@proa/protocol";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompt.js";

export interface AnthropicOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
}

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

function toolDefs(tools: readonly ToolName[]): ToolDef[] {
  const defs: Record<string, ToolDef> = {
    navigate: def("navigate", "Load a URL in the current tab.", { url: str() }, ["url"]),
    click: def("click", "Click the IR node with this ref.", { ref: str() }, ["ref"]),
    type: def("type", "Type text into the IR node.", { ref: str(), text: str(), submit: bool() }, ["ref", "text"]),
    select: def("select", "Choose an option in a select.", { ref: str(), value: str() }, ["ref", "value"]),
    scroll: def("scroll", "Scroll the page.", { direction: str(), amount: num() }, []),
    waitFor: def("waitFor", "Wait for text or a node.", { text: str(), ref: str(), timeoutMs: num() }, []),
    extract: def("extract", "Extract typed data by schema.", { schema: obj(), instruction: str() }, ["schema"]),
    screenshot: def("screenshot", "Capture a screenshot.", { fullPage: bool() }, []),
    "tabs.open": def("tabs.open", "Open a new tab.", { url: str() }, []),
    download: def("download", "Download a file (gated).", { ref: str(), url: str() }, []),
    askHuman: def("askHuman", "Ask the human a question.", { question: str() }, ["question"]),
  };
  const out = tools.map((t) => defs[t]).filter(Boolean) as ToolDef[];
  out.push(def(DONE_TOOL, "Finish the task with a summary.", { summary: str() }, ["summary"]));
  return out;
}

const str = () => ({ type: "string" });
const num = () => ({ type: "number" });
const bool = () => ({ type: "boolean" });
const obj = () => ({ type: "object" });
function def(name: string, description: string, props: Record<string, unknown>, required: string[]): ToolDef {
  return { name, description, input_schema: { type: "object", properties: props, required } };
}

/**
 * First-class Anthropic provider using the Messages API tool-use loop. Used for local
 * smoke only — never in CI (ADR-0006). Uses fetch to avoid a heavy SDK dependency.
 */
export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic";
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private maxTokens: number;

  constructor(opts: AnthropicOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    this.model = opts.model ?? process.env.PROA_MODEL ?? "claude-3-5-sonnet-latest";
    this.baseUrl = opts.baseUrl ?? "https://api.anthropic.com";
    this.maxTokens = opts.maxTokens ?? 1024;
    if (!this.apiKey) throw new Error("AnthropicProvider requires ANTHROPIC_API_KEY");
  }

  async decide(ctx: ModelContext): Promise<ModelDecision> {
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        system: SYSTEM_PROMPT,
        tools: toolDefs(ctx.tools),
        tool_choice: { type: "any" },
        messages: [{ role: "user", content: buildUserMessage(ctx) }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      content: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = data.content.find((c) => c.type === "text")?.text ?? "";
    const toolUse = data.content.find((c) => c.type === "tool_use");
    if (!toolUse?.name) {
      return { thought: text || "no tool call", action: { tool: DONE_TOOL, params: { summary: text } } };
    }
    const action: AgentAction = { tool: toolUse.name as AgentAction["tool"], params: toolUse.input ?? {} };
    return {
      thought: text || `calling ${toolUse.name}`,
      action,
      usage: {
        inputTokens: data.usage?.input_tokens,
        outputTokens: data.usage?.output_tokens,
      },
    };
  }
}
