import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ProaSession } from "./session.js";

export interface BridgeOptions {
  token?: string;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(json);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/**
 * A token-gated HTTP JSON bridge mirroring the MCP tool surface. Used by the SDK's
 * `connect()` and by `curl`. External MCP clients (Claude Code) use the stdio server
 * (see server.ts). One tool vocabulary across stdio, HTTP, SDK, and CLI (parity).
 */
export function createBridge(session: ProaSession, opts: BridgeOptions = {}): Server {
  return createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type, authorization",
        "access-control-allow-methods": "POST, GET, OPTIONS",
      });
      return res.end();
    }
    if (req.url === "/health") return send(res, 200, { ok: true });

    if (opts.token) {
      const auth = req.headers.authorization ?? "";
      if (auth !== `Bearer ${opts.token}`) return send(res, 401, { ok: false, error: "unauthorized" });
    }

    if (req.method === "POST" && (req.url === "/call" || req.url === "/mcp/call")) {
      try {
        const { tool, params } = JSON.parse((await readBody(req)) || "{}") as {
          tool: string;
          params?: Record<string, unknown>;
        };
        const result = await session.call(tool, params ?? {});
        return send(res, result.ok ? 200 : 400, result);
      } catch (err) {
        return send(res, 400, { ok: false, error: (err as Error).message });
      }
    }

    send(res, 404, { ok: false, error: "not found" });
  });
}

export function serveBridge(
  session: ProaSession,
  opts: BridgeOptions & { port?: number } = {},
): Promise<{ server: Server; port: number }> {
  const server = createBridge(session, opts);
  const port = opts.port ?? 8787;
  return new Promise((resolve) => {
    server.listen(port, () => resolve({ server, port }));
  });
}
