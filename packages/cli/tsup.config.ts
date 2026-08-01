import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", cli: "src/cli.ts" },
  format: ["esm"],
  dts: { entry: { index: "src/index.ts" } },
  clean: true,
  sourcemap: true,
  target: "node20",
  tsconfig: "tsconfig.build.json",
  banner: { js: "#!/usr/bin/env node" },
  external: [
    "@proa/protocol",
    "@proa/extractor",
    "@proa/permissions",
    "@proa/traces",
    "@proa/core",
    "@proa/sdk",
    "@proa/mcp",
    "better-sqlite3",
    "electron",
  ],
});
