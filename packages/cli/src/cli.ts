import { buildProgram } from "./program.js";

buildProgram().parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
