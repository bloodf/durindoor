import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(__dirname, "..");

async function generateMarkdown() {
  const executorsPath = path.join(root, "open-sse/executors/index.js");
  const executorsSource = await readFile(executorsPath, "utf8");

  // Map class import names to source files, e.g. AntigravityExecutor -> ./antigravity.js
  const importRe = /import\s+\{\s*([^}]+)\s*\}\s+from\s+["']([^"']+)["'];?/g;
  const classToFile = new Map();
  for (const m of executorsSource.matchAll(importRe)) {
    const names = m[1].split(",").map(s => s.trim());
    const src = m[2];
    for (const name of names) {
      classToFile.set(name, src);
    }
  }

  // Parse the const executors = { ... } block to collect id -> className
  const executorsBlockMatch = executorsSource.match(/const\s+executors\s*=\s*\{([\s\S]*?)\};/);
  if (!executorsBlockMatch) throw new Error("Could not find executors map in open-sse/executors/index.js");
  const executorsBlock = executorsBlockMatch[1];
  const idToClass = new Map();
  for (const m of executorsBlock.matchAll(/(["']?)([\w-]+)\1\s*:\s*new\s+(\w+)\s*\(/g)) {
    idToClass.set(m[2], m[3]);
  }

  const registryModule = await import(path.join(root, "open-sse/providers/registry/index.js"));
  const registry = registryModule.default;

  const providerIds = registry.map(p => p.id).sort();
  const executorIds = Array.from(idToClass.keys()).sort();

  const executorRows = executorIds.map(id => {
    const className = idToClass.get(id);
    const src = classToFile.get(className);
    return `| \`${id}\` | ${className} | \`${src ?? "./default.js"}\` |`;
  });

  const providerRows = providerIds.map(id => {
    const p = registry.find(r => r.id === id);
    const transport = p.transport || {};
    return `| \`${id}\` | ${transport.format ?? ""} | ${p.category ?? ""} | \`${transport.baseUrl ?? ""}\` |`;
  });

  return `# Agent Index

Auto-generated index of executors and providers.
Run \`node scripts/gen-agent-index.mjs\` to regenerate.

## Executors

| id | executor | source file |
|---|---|---|
${executorRows.join("\n")}

## Providers

| id | format | category | baseUrl |
|---|---|---|---|
${providerRows.join("\n")}
`;
}

export { generateMarkdown };

async function main() {
  const markdown = await generateMarkdown();
  const outPath = path.join(root, "open-sse/AGENT-INDEX.md");
  await writeFile(outPath, markdown);
  console.log(`wrote ${outPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
