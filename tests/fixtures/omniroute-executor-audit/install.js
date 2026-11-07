import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function installExecutorContract(root, revision = "61e07fb7") {
  const dir = join(root, "open-sse/executors");
  mkdirSync(dir, { recursive: true });
  for (const [target, source] of [["index", "executors"], ["registry", "registry"], ["defaultResolver", "defaultResolver"]]) {
    writeFileSync(join(dir, `${target}.ts`), readFileSync(new URL(`./${source}-${revision}.txt`, import.meta.url)));
  }
}
