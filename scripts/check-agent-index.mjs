import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateMarkdown } from "./gen-agent-index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const committedPath = path.join(root, "open-sse/AGENT-INDEX.md");

const generated = await generateMarkdown();
const committed = await readFile(committedPath, "utf8").catch(() => "");

if (generated !== committed) {
  console.error("AGENT-INDEX.md drift detected. Run `npm run gen:agent-index` and commit the result.");
  process.exit(1);
}
console.log("AGENT-INDEX.md is up to date.");
