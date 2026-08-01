import { existsSync, mkdirSync, readdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TraceMeta } from "@proa/protocol";
import { TraceWriter } from "./writer.js";
import { parseJSONL, type ParsedTrace } from "./parse.js";

/**
 * Filesystem trace store: one append-only JSONL file per session plus a screenshots
 * directory. Grep-able and diff-able on disk (ADR-0004). Traces never leave the machine.
 */
export class FileTraceStore {
  constructor(private readonly rootDir: string) {
    mkdirSync(this.rootDir, { recursive: true });
  }

  private fileFor(traceId: string): string {
    return join(this.rootDir, `${traceId}.jsonl`);
  }

  screenshotDir(traceId: string): string {
    const dir = join(this.rootDir, traceId);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Create a writer that appends each event to disk as it happens (true append-only). */
  create(meta: TraceMeta, opts: { now?: () => string } = {}): TraceWriter {
    const file = this.fileFor(meta.traceId);
    writeFileSync(file, JSON.stringify({ kind: "proa.trace.meta", ...meta }) + "\n");
    return new TraceWriter(meta, {
      now: opts.now,
      onAppend: (e) => appendFileSync(file, JSON.stringify(e) + "\n"),
    });
  }

  list(): TraceMeta[] {
    if (!existsSync(this.rootDir)) return [];
    return readdirSync(this.rootDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const first = readFileSync(join(this.rootDir, f), "utf8").split("\n", 1)[0]!;
        const { kind: _k, ...meta } = JSON.parse(first) as { kind?: string } & TraceMeta;
        return meta as TraceMeta;
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  read(traceId: string): ParsedTrace {
    return parseJSONL(readFileSync(this.fileFor(traceId), "utf8"));
  }
}
