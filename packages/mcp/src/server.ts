import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { ProaSession } from "./session.js";
import { TOOL_DEFS, type ToolParam } from "./tools.js";

function zodFor(param: ToolParam): z.ZodTypeAny {
  let base: z.ZodTypeAny;
  switch (param.type) {
    case "number":
      base = z.number();
      break;
    case "boolean":
      base = z.boolean();
      break;
    case "object":
      base = z.record(z.any());
      break;
    default:
      base = z.string();
  }
  if (param.description) base = base.describe(param.description);
  return param.required ? base : base.optional();
}

function shapeFor(params: Record<string, ToolParam>): z.ZodRawShape {
  const shape: z.ZodRawShape = {};
  for (const [key, p] of Object.entries(params)) shape[key] = zodFor(p);
  return shape;
}

/**
 * Build the MCP server exposing Proa's tools. The browser IS an MCP server: any external
 * agent (Claude Code, a CI job) can open tabs, act, extract, and screenshot through it —
 * with the human watching real windows when this is bound to the desktop app.
 */
export function createMcpServer(session: ProaSession): McpServer {
  const server = new McpServer({ name: "proa", version: "0.1.0" });
  for (const def of TOOL_DEFS) {
    server.tool(def.name, def.description, shapeFor(def.params), async (args: Record<string, unknown>) => {
      const r = await session.call(def.name, args ?? {});
      return {
        content: [{ type: "text" as const, text: JSON.stringify(r.ok ? r.result : { error: r.error }) }],
        isError: !r.ok,
      };
    });
  }
  return server;
}

/** Serve MCP over stdio — the transport for `claude mcp add proa -- proa mcp serve`. */
export async function serveStdio(session: ProaSession): Promise<McpServer> {
  const server = createMcpServer(session);
  await server.connect(new StdioServerTransport());
  return server;
}
