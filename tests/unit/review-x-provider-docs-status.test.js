import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const docsDir = path.join(repoRoot, "docs/providers");
const registryIndex = fs.readFileSync(path.join(repoRoot, "open-sse/providers/registry/index.js"), "utf8");
const registeredIds = new Set(
  [...registryIndex.matchAll(/from "\.\/([^"/]+)\.js";/g)].map((match) => match[1]),
);

describe("provider documentation release status", () => {
  it("marks every unregistered provider page unreleased", () => {
    const pages = fs.readdirSync(docsDir).filter((name) => {
      if (!/\.(md|mdx)$/.test(name)) return false;
      const id = name.replace(/\.(md|mdx)$/, "");
      const content = fs.readFileSync(path.join(docsDir, name), "utf8");
      return registeredIds.has(id) || /status:\s*unreleased/.test(content) || ["monsterapi", "promptql", "syntx", "helyxai", "hyperagent", "tabitoken", "twinmind"].includes(id) || id.startsWith("g4f-");
    });
    const missing = pages.filter((name) => {
      const id = name.replace(/\.(md|mdx)$/, "");
      if (registeredIds.has(id)) return false;
      const content = fs.readFileSync(path.join(docsDir, name), "utf8");
      const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
      return !frontmatter || !/^status:\s*unreleased\s*$/m.test(frontmatter[1]);
    });

    expect(missing).toEqual([]);
  });
});
