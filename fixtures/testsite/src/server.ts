import { createServer, type Server } from "node:http";
import { resolve } from "./site.js";

/** Serve the fixture site over HTTP (used by Playwright e2e). */
export function createTestSite(): Server {
  return createServer((req, res) => {
    const url = req.url ?? "/";
    const html = resolve(url);
    const notFound = html.includes("<title>Not found</title>");
    res.writeHead(notFound ? 404 : 200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
}

export function startTestSite(port = 4321): Promise<{ server: Server; port: number; url: string }> {
  const server = createTestSite();
  return new Promise((resolveP) => {
    server.listen(port, () => {
      const addr = server.address();
      const actual = typeof addr === "object" && addr ? addr.port : port;
      resolveP({ server, port: actual, url: `http://127.0.0.1:${actual}` });
    });
  });
}
