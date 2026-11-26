// Keep action references immutable and let Renovate update their annotated versions.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function yamlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return yamlFiles(file);
    return entry.isFile() && entry.name.endsWith(".yml") ? [file] : [];
  });
}

describe("GitHub Actions pins", () => {
  it("pins every non-local action to a SHA with a version comment", () => {
    const references = yamlFiles(path.join(root, ".github")).flatMap((file) =>
      readFileSync(file, "utf8").split(/\r?\n/).flatMap((line, index) => {
        const match = line.match(/^\s*(?:-\s*)?uses:\s*(.*?)\s*$/);
        return match && !match[1].startsWith("./") ? [{ file, line: index + 1, value: match[1] }] : [];
      })
    );
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(reference.value, `${reference.file}:${reference.line}`).toMatch(
        /^[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*@[a-fA-F0-9]{40}\s+#\s+v\S+$/
      );
    }
  });

  it("enables Renovate digest updates", () => {
    const config = JSON.parse(readFileSync(path.join(root, "renovate.json"), "utf8"));
    expect(config.extends).toContain("helpers:pinGitHubActionDigests");
  });
});
