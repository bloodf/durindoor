// Smoke test for the demo mock layer, runnable without a browser:
//   node --import ./scripts/register-alias.mjs scripts/mock-smoke.mjs [paths-file]
// Registers every handler, then reports which dashboard API paths have no
// route and which handlers throw for a plain GET.
import { readFileSync } from "node:fs";
import { createRouter } from "../src/mock/router.js";
import { store } from "../src/mock/store.js";
import { registerAll } from "../src/mock/handlers/index.js";

const router = createRouter();
registerAll(router, { store, external: () => {} });

const file = process.argv[2];
const paths = file
  ? readFileSync(file, "utf8").split("\n").map((line) => line.trim()).filter(Boolean)
  : [];

const sample = (path) => path.replace(/\$\{[^}]*\}?/g, "demo-id").replace(/demo-id[^/]*$/, "demo-id");
let missing = 0;
let failed = 0;
for (const raw of paths) {
  const path = sample(raw);
  const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((method) => router.match(method, path));
  if (!methods.length) {
    missing += 1;
    console.log(`MISSING ${raw}`);
    continue;
  }
  if (methods.includes("GET")) {
    const found = router.match("GET", path);
    const url = new URL(`http://demo.local${path}`);
    try {
      await found.route.handler({ method: "GET", url, params: found.params, query: {}, searchParams: url.searchParams, body: undefined });
    } catch (error) {
      failed += 1;
      console.log(`THROWS  GET ${raw}: ${error.message}`);
    }
  }
}
console.log(`routes=${router.size()} checked=${paths.length} missing=${missing} throwing=${failed}`);
