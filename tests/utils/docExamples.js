import fs from "node:fs";
import path from "node:path";

export const DOC_EXAMPLE_ROOTS = [".env.example", "README.md", "docker-compose.yml", "docs", "website"];
const DOC_EXTENSION = /\.(mdx?|ya?ml|example)$/i;

/** Collect the same documented-example files without entering ignored dependencies. */
export function collectDocExampleFiles(repoRoot, roots = DOC_EXAMPLE_ROOTS) {
  const files = [];
  for (const root of roots) {
    const abs = path.join(repoRoot, root);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isFile()) { files.push(abs); continue; }
    const directories = [abs];
    for (let index = 0; index < directories.length; index += 1) {
      for (const entry of fs.readdirSync(directories[index], { withFileTypes: true })) {
        // The previous scanner filtered these exact components after recursively
        // enumerating them. Prune before traversal without changing coverage.
        if (entry.name === "node_modules") continue;
        const file = path.join(directories[index], entry.name);
        if (entry.isDirectory()) directories.push(file);
        else if (DOC_EXTENSION.test(file) && fs.statSync(file).isFile()) files.push(file);
      }
    }
  }
  return files;
}

/** Literal NAME=value / NAME: value examples, retaining the original parser. */
export function scanDocExamples(name, repoRoot, roots = DOC_EXAMPLE_ROOTS) {
  const found = new Map();
  const re = new RegExp(`\\b${name}[ \\t]*[=:][ \\t]*["']?([^"'\\s\`]*)`, "g");
  for (const file of collectDocExampleFiles(repoRoot, roots)) {
    for (const match of fs.readFileSync(file, "utf8").matchAll(re)) {
      if (match[1] && !/^[$<]/.test(match[1])) found.set(match[1], path.relative(repoRoot, file));
    }
  }
  return found;
}
