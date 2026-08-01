import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node20",
  tsconfig: "tsconfig.build.json",
  external: [
    "@proa/protocol",
    "@proa/extractor",
    "@proa/permissions",
    "@proa/traces",
    "@proa/core",
    "@proa/sdk",
    "better-sqlite3",
    "electron",
  ],
});
