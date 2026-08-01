import { startTestSite } from "./server.js";

const port = Number(process.env.PORT ?? 4321);
startTestSite(port).then(({ url }) => {
  console.log(`Proa fixture site running at ${url}`);
});
