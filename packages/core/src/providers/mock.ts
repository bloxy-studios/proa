import type { IRNode, ModelContext, ModelDecision, ModelProvider, PageIR } from "@proa/protocol";
import { DONE_TOOL, findNode } from "@proa/protocol";

/** A scripted step: a fixed decision, or a function of the live context. */
export type MockScriptStep = ModelDecision | ((ctx: ModelContext) => ModelDecision);

/**
 * Deterministic provider that replays a scripted sequence of decisions. The backbone of
 * CI (ADR-0006): no API key, no network, identical every run. Steps can be functions so
 * they resolve refs against the live IR (robust to IR renumbering).
 */
export class MockProvider implements ModelProvider {
  readonly name = "mock";
  private i = 0;

  constructor(private readonly script: MockScriptStep[]) {}

  async decide(ctx: ModelContext): Promise<ModelDecision> {
    if (this.i >= this.script.length) {
      return {
        thought: "no more scripted steps",
        action: { tool: DONE_TOOL, params: { summary: "done (script exhausted)" } },
      };
    }
    const step = this.script[this.i++]!;
    return typeof step === "function" ? step(ctx) : step;
  }
}

/** Find an IR node's ref by role and/or accessible-name substring. */
export function refByName(ir: PageIR, name: string, role?: string): string | undefined {
  const node = findNode(
    ir.root,
    (n: IRNode) =>
      (!role || n.role === role) &&
      !!n.name &&
      n.name.toLowerCase().includes(name.toLowerCase()),
  );
  return node?.ref;
}

/** Find the first ref for a role (e.g. first button). */
export function refByRole(ir: PageIR, role: string): string | undefined {
  return findNode(ir.root, (n) => n.role === role)?.ref;
}
