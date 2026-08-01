import type { AgentAction, ModelContext, ModelDecision, ModelProvider } from "@proa/protocol";
import { DONE_TOOL } from "@proa/protocol";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompt.js";

export interface OpenAIOptions {
  apiKey?: string;
  model?: string;
  /** OpenAI-compatible base URL (OpenAI, Together, Ollama, vLLM, …). */
  baseUrl?: string;
}

/**
 * OpenAI-compatible provider (chat completions with a single JSON tool call). Second-class
 * after Anthropic; works against any OpenAI-compatible endpoint. Local use only.
 */
export class OpenAIProvider implements ModelProvider {
  readonly name = "openai";
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(opts: OpenAIOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.model = opts.model ?? process.env.PROA_MODEL ?? "gpt-4o-mini";
    this.baseUrl = opts.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    if (!this.apiKey) throw new Error("OpenAIProvider requires OPENAI_API_KEY");
  }

  async decide(ctx: ModelContext): Promise<ModelDecision> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `${buildUserMessage(ctx)}

Reply ONLY with JSON: {"thought": string, "tool": string, "params": object}. Use tool "done" when finished.`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const raw = data.choices[0]?.message.content ?? "{}";
    let parsed: { thought?: string; tool?: string; params?: Record<string, unknown> };
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { tool: DONE_TOOL, params: { summary: raw } };
    }
    const action: AgentAction = {
      tool: (parsed.tool as AgentAction["tool"]) ?? DONE_TOOL,
      params: parsed.params ?? {},
    };
    return {
      thought: parsed.thought ?? "",
      action,
      usage: {
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
      },
    };
  }
}
