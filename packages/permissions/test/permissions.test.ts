import { describe, it, expect, vi } from "vitest";
import type { AgentAction, PageIR, IRNode } from "@proa/protocol";
import {
  PermissionEngine,
  MemoryLedgerStore,
  classifyAction,
  allowAll,
  denyAll,
  allowReversibleOnly,
  domainOf,
} from "../src/index.js";

function ir(nodes: IRNode[]): PageIR {
  const root: IRNode = { ref: "n0", role: "document", children: nodes };
  return {
    url: "https://shop.test/cart",
    title: "Cart",
    capturedAt: new Date(0).toISOString(),
    root,
    nodeCount: nodes.length + 1,
    tainted: false,
  };
}

const AGENT = "agent-1";
const SPACE = "work";
const DOMAIN = "shop.test";

describe("classifyAction", () => {
  it("maps base capabilities", () => {
    expect(classifyAction({ tool: "click", params: { ref: "n1" } }).capability).toBe("act:click");
    expect(classifyAction({ tool: "type", params: { ref: "n1", text: "x" } }).capability).toBe("act:type");
    expect(classifyAction({ tool: "scroll", params: {} }).capability).toBe("act:scroll");
    expect(classifyAction({ tool: "extract", params: {} }).capability).toBe("read");
  });

  it("escalates a destructive target to the irreversible class", () => {
    const page = ir([{ ref: "n1", role: "button", name: "Delete account" }]);
    const c = classifyAction({ tool: "click", params: { ref: "n1" } }, page);
    expect(c.irreversible).toBe("delete");
    expect(c.target).toBe("Delete account");
  });

  it("classifies payment and send buttons", () => {
    const page = ir([
      { ref: "n1", role: "button", name: "Place order" },
      { ref: "n2", role: "button", name: "Send message" },
    ]);
    expect(classifyAction({ tool: "click", params: { ref: "n1" } }, page).irreversible).toBe("payment");
    expect(classifyAction({ tool: "click", params: { ref: "n2" } }, page).irreversible).toBe("send");
  });

  it("treats type+submit as act:submit", () => {
    const c = classifyAction({ tool: "type", params: { ref: "n1", text: "x", submit: true } });
    expect(c.capability).toBe("act:submit");
  });
});

describe("PermissionEngine", () => {
  const read: AgentAction = { tool: "extract", params: {} };
  const click: AgentAction = { tool: "click", params: { ref: "n1" } };

  it("allows free capabilities with no prompt", async () => {
    const prompter = vi.fn(denyAll);
    const eng = new PermissionEngine({ prompter });
    const d = await eng.check({ agent: AGENT, space: SPACE, domain: DOMAIN, action: read });
    expect(d.allowed).toBe(true);
    expect(prompter).not.toHaveBeenCalled();
  });

  it("prompts once for a write grant, then remembers it per Space", async () => {
    const prompter = vi.fn(allowAll);
    const eng = new PermissionEngine({ prompter });
    const first = await eng.check({ agent: AGENT, space: SPACE, domain: DOMAIN, action: click });
    const second = await eng.check({ agent: AGENT, space: SPACE, domain: DOMAIN, action: click });
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(second.remembered).toBe(true);
    expect(prompter).toHaveBeenCalledTimes(1); // remembered on the second call
  });

  it("does not leak a grant across Spaces", async () => {
    const prompter = vi.fn(allowAll);
    const eng = new PermissionEngine({ prompter });
    await eng.check({ agent: AGENT, space: "work", domain: DOMAIN, action: click });
    await eng.check({ agent: AGENT, space: "personal", domain: DOMAIN, action: click });
    expect(prompter).toHaveBeenCalledTimes(2);
  });

  it("ALWAYS prompts fresh for the irreversible class and never remembers it", async () => {
    const page = ir([{ ref: "n1", role: "button", name: "Delete account" }]);
    const prompter = vi.fn(allowAll);
    const eng = new PermissionEngine({ prompter });
    const a = await eng.check({ agent: AGENT, space: SPACE, domain: DOMAIN, action: click, ir: page });
    const b = await eng.check({ agent: AGENT, space: SPACE, domain: DOMAIN, action: click, ir: page });
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    expect(a.remembered).toBe(false);
    expect(prompter).toHaveBeenCalledTimes(2); // fresh grant every time
  });

  it("blocks irreversible actions when the human denies (the injection defense)", async () => {
    const page = ir([{ ref: "n1", role: "button", name: "Delete account" }]);
    const eng = new PermissionEngine({ prompter: allowReversibleOnly });
    const d = await eng.check({ agent: AGENT, space: SPACE, domain: DOMAIN, action: click, ir: page });
    expect(d.allowed).toBe(false);
    expect(d.irreversible).toBe("delete");
  });

  it("records every decision in the ledger", async () => {
    const store = new MemoryLedgerStore();
    const eng = new PermissionEngine({ store, prompter: allowAll });
    await eng.check({ agent: AGENT, space: SPACE, domain: DOMAIN, action: click });
    const entries = eng.ledgerFor(DOMAIN, SPACE);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.decision).toBe("allow");
    expect(entries[0]!.tool).toBe("click");
  });
});

describe("domainOf", () => {
  it("extracts host", () => {
    expect(domainOf("https://news.ycombinator.com/item?id=1")).toBe("news.ycombinator.com");
    expect(domainOf("not a url")).toBe("local");
  });
});
