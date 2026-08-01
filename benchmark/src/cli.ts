import { runBenchmark } from "./run.js";

const traceDir = process.env.PROA_BENCH_TRACE_DIR;
const results = await runBenchmark({ traceDir });

let failed = 0;
console.log("\nProa agent benchmark (MockProvider · DomEngine)\n");
for (const r of results) {
  const mark = r.pass ? "[32m✓[0m" : "[31m✗[0m";
  console.log(`  ${mark} ${r.name.padEnd(20)} ${r.pass ? "" : "— " + r.detail}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} tasks passed.\n`);
process.exit(failed === 0 ? 0 : 1);
