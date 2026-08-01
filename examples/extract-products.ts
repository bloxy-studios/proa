/**
 * Example headless task: turn a page into typed JSON. Run it with:
 *   proa run examples/extract-products.ts --json
 * It uses the bundled fixture site so it works offline and in CI.
 */
import { z } from "zod";
import { proa } from "@proa/sdk";
import { resolve } from "@proa/testsite";

const app = await proa.launch({ headless: true, resolve, baseUrl: "https://fixture.test" });
const tab = await app.tabs.open("https://fixture.test/products");

const Product = z.object({
  name: z.string(),
  price: z.number(),
  rating: z.number(),
  inStock: z.boolean(),
});

const products = await tab.extract(z.array(Product).max(10));

if (process.env.PROA_JSON) {
  console.log(JSON.stringify(products, null, 2));
} else {
  console.table(products);
}

await app.close();
