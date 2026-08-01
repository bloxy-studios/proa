import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Command } from "commander";
import pc from "picocolors";
import { FileTraceStore, Replayer, toPlaywrightTest, verifyChain } from "@proa/traces";
import { ProaSession, serveStdio, serveBridge } from "@proa/mcp";
import { connect } from "@proa/sdk";

const DEFAULT_TRACE_DIR = process.env.PROA_TRACE_DIR ?? ".proa/traces";

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("proa")
    .description("Proa — the agent-native browser for developers")
    .version("0.1.0");

  // ---- doctor ---------------------------------------------------------------
  program
    .command("doctor")
    .description("Check the environment and report what works")
    .action(() => {
      const rows: [string, string, boolean][] = [];
      const nodeOk = Number(process.versions.node.split(".")[0]) >= 20;
      rows.push(["Node ≥ 20", process.versions.node, nodeOk]);
      const display = !!process.env.DISPLAY || process.platform === "darwin";
      rows.push(["Display for GUI", display ? "available" : "headless (use --headless / CI)", true]);
      rows.push(["Headless engine (jsdom)", "always available", true]);
      const key = !!process.env.ANTHROPIC_API_KEY || !!process.env.OPENAI_API_KEY;
      rows.push(["Model API key", key ? "configured" : "not set (agent runs need one; MockProvider for tests)", true]);
      let electron = false;
      try {
        createRequire(import.meta.url).resolve("electron");
        electron = true;
      } catch {
        /* not installed at this scope */
      }
      rows.push(["Electron (desktop app)", electron ? "installed" : "not in scope (app runs from apps/browser)", true]);

      console.log(pc.bold("\nProa doctor\n"));
      for (const [name, detail, ok] of rows) {
        console.log(`  ${ok ? pc.green("✓") : pc.red("✗")} ${pc.bold(name.padEnd(26))} ${pc.dim(detail)}`);
      }
      console.log("");
    });

  // ---- run <file> -----------------------------------------------------------
  program
    .command("run <file>")
    .description("Run a headless task file (TypeScript/ESM) that uses @proa/sdk")
    .option("--json", "hint the task to emit JSON (sets PROA_JSON=1)")
    .option("--headless", "run without a display (default)", true)
    .action(async (file: string, opts: { json?: boolean }) => {
      if (opts.json) process.env.PROA_JSON = "1";
      process.env.PROA_HEADLESS = "1";
      const abs = resolvePath(process.cwd(), file);
      const href = pathToFileURL(abs).href;
      try {
        if (file.endsWith(".ts") || file.endsWith(".tsx")) {
          const { tsImport } = (await import("tsx/esm/api")) as { tsImport: (s: string, p: string) => Promise<unknown> };
          await tsImport(href, import.meta.url);
        } else {
          await import(href);
        }
      } catch (err) {
        console.error(pc.red(`run failed: ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  // ---- trace ----------------------------------------------------------------
  const trace = program.command("trace").description("Inspect, replay, and export session traces");

  trace
    .command("ls")
    .description("List recorded traces")
    .option("--dir <dir>", "trace directory", DEFAULT_TRACE_DIR)
    .action((opts: { dir: string }) => {
      const store = new FileTraceStore(opts.dir);
      const metas = store.list();
      if (metas.length === 0) return console.log(pc.dim(`no traces in ${opts.dir}`));
      for (const m of metas) {
        console.log(`${pc.cyan(m.traceId)}  ${pc.dim(m.createdAt)}  ${m.provider}/${m.engine}  ${m.task}`);
      }
    });

  trace
    .command("replay <id>")
    .description("Print the deterministic action sequence of a trace")
    .option("--dir <dir>", "trace directory", DEFAULT_TRACE_DIR)
    .action((id: string, opts: { dir: string }) => {
      const parsed = new FileTraceStore(opts.dir).read(id);
      const chain = verifyChain(parsed.events);
      console.log(chain.ok ? pc.green("✓ hash chain intact") : pc.red(`✗ chain broken at ${chain.brokenAt}`));
      const steps = new Replayer(parsed.events).steps();
      steps.forEach((s, i) => {
        console.log(`${pc.dim(String(i + 1).padStart(2))}. ${pc.bold(s.action.tool)} ${JSON.stringify(s.action.params)}`);
      });
    });

  trace
    .command("export <id>")
    .description("Export a trace to a runnable test")
    .requiredOption("--as <format>", "output format (playwright)")
    .option("--dir <dir>", "trace directory", DEFAULT_TRACE_DIR)
    .option("--out <file>", "write to a file instead of stdout")
    .action((id: string, opts: { as: string; dir: string; out?: string }) => {
      if (opts.as !== "playwright") {
        console.error(pc.red(`unsupported format: ${opts.as} (try --as playwright)`));
        process.exitCode = 1;
        return;
      }
      const parsed = new FileTraceStore(opts.dir).read(id);
      const code = toPlaywrightTest(parsed);
      if (opts.out) {
        writeFileSync(opts.out, code);
        console.log(pc.green(`wrote ${opts.out}`));
      } else {
        process.stdout.write(code);
      }
    });

  // ---- mcp serve ------------------------------------------------------------
  program
    .command("mcp")
    .description("Model Context Protocol server")
    .command("serve")
    .description("Serve Proa as an MCP server (stdio by default)")
    .option("--http", "serve the HTTP bridge instead of stdio")
    .option("--port <port>", "HTTP port", "8787")
    .option("--token <token>", "bearer token for the HTTP bridge")
    .action(async (opts: { http?: boolean; port: string; token?: string }) => {
      const session = new ProaSession();
      if (opts.http) {
        const { port } = await serveBridge(session, { port: Number(opts.port), token: opts.token });
        console.error(pc.green(`Proa HTTP bridge on http://127.0.0.1:${port} (POST /call)`));
      } else {
        // stdio: keep stdout clean for the protocol; log to stderr.
        console.error(pc.dim("Proa MCP server on stdio. Add with: claude mcp add proa -- proa mcp serve"));
        await serveStdio(session);
      }
    });

  // ---- open <url> -----------------------------------------------------------
  program
    .command("open <url>")
    .description("Open a URL in a running Proa (via its HTTP bridge)")
    .option("--endpoint <url>", "bridge endpoint", process.env.PROA_ENDPOINT ?? "http://127.0.0.1:8787")
    .action(async (url: string, opts: { endpoint: string }) => {
      try {
        const app = await connect({ endpoint: opts.endpoint });
        const tab = await app.tabs.open(url);
        console.log(pc.green(`opened ${url} in tab ${tab.id}`));
      } catch (err) {
        console.error(pc.red((err as Error).message));
        process.exitCode = 1;
      }
    });

  return program;
}
