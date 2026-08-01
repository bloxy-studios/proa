/**
 * @proa/sdk — the developer-facing SDK. Everything the UI can do, the SDK can do
 * (parity principle). `launch({ headless: true })` runs the same core against the jsdom
 * engine; `connect()` drives a running desktop app over its HTTP bridge.
 *
 * @example
 * import { proa } from "@proa/sdk";
 * import { z } from "zod";
 * const app = await proa.launch({ headless: true });
 * const tab = await app.tabs.open("https://news.ycombinator.com");
 * const Story = z.object({ rank: z.number(), title: z.string(), points: z.number(), url: z.string().url() });
 * const top5 = await tab.extract(z.array(Story).max(5));
 */
export * from "./app.js";
export * from "./connect.js";
export * from "./zod.js";
export * from "./permissions.js";

import { launch } from "./app.js";
import { connect } from "./connect.js";

/** The Proa SDK entry object. */
export const proa = { launch, connect };
export default proa;
