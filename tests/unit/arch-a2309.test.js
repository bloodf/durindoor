import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import providers from "../../open-sse/providers/registry/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const providersDocs = path.join(repoRoot, "docs/providers");

// These pages explain provider features or workflows; their filenames are not
// provider IDs. claude-code is handled as an alias for the registered claude ID.
const referencePages = new Set([
  "api-key-providers",
  "catalog",
  "connecting-accounts",
  "cookie-capture-extension",
  "free-and-local",
  "index",
  "local-router-providers",
  "network-llm-servers",
  "openai-compatible-nodes",
  "retired",
  "sign-in-methods",
  "web-cookie",
]);
const providerPageAliases = new Map([["claude-code", "claude"]]);

describe("provider documentation registration (#2309)", () => {
  it("maps provider pages to the registry or marks them unreleased", async () => {
    const registeredIds = new Set(providers.map(({ id }) => id));
    const pages = (await readdir(providersDocs)).filter((file) => file.endsWith(".mdx"));

    for (const file of pages) {
      const page = file.slice(0, -4);
      if (referencePages.has(page)) continue;

      const providerId = providerPageAliases.get(page) ?? page;
      if (registeredIds.has(providerId)) continue;

      const content = await readFile(path.join(providersDocs, file), "utf8");
      const [, frontmatter, body] = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/) ?? [];

      expect(frontmatter, `${file} must have YAML frontmatter`).toBeDefined();
      expect(frontmatter, `${file} must declare status: unreleased`).toMatch(/^status:\s*unreleased\s*$/m);
      expect(body, `${file} must start with a Not yet available admonition`).toMatch(
        /^<Callout\b[^>]*>Not yet available\b/i,
      );
    }
  });
});
