import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectDocExampleFiles, scanDocExamples } from "../utils/docExamples.js";

const temporary = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-doc-examples-"));
  temporary.push(root);
  for (const file of [".env.example", "README.md", "docker-compose.yml", "docs/a.md", "docs/nested/a.mdx", "docs/UPPER.MDX",
    "website/.hidden/a.yaml", "website/.next/a.md", "website/node_modules-lookalike/a.md",
    "website/node_modules/pkg/ignored.md", "website/deep/node_modules/pkg/ignored.md", "website/code.js"]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), "INITIAL_PASSWORD=change-me\nJWT_SECRET: replace-me\n");
  }
  return root;
}
afterEach(() => { vi.restoreAllMocks(); for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function oldFiles(root) {
  const files = [];
  for (const name of [".env.example", "README.md", "docker-compose.yml", "docs", "website"]) {
    const abs = path.join(root, name);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isFile()) { files.push(abs); continue; }
    for (const rel of fs.readdirSync(abs, { recursive: true })) {
      if (String(rel).split(path.sep).includes("node_modules")) continue;
      const file = path.join(abs, rel);
      if (/\.(mdx?|ya?ml|example)$/i.test(file) && fs.statSync(file).isFile()) files.push(file);
    }
  }
  return files;
}

describe("document example scan retains security coverage", () => {
  it("collects exactly the previous file set, including hidden/build docs and similar directory names", () => {
    const root = fixture();
    expect(collectDocExampleFiles(root).sort()).toEqual(oldFiles(root).sort());
    expect(collectDocExampleFiles(root)).toContain(path.join(root, "website/.next/a.md"));
    expect(collectDocExampleFiles(root)).toContain(path.join(root, "website/node_modules-lookalike/a.md"));
    expect(collectDocExampleFiles(root)).toContain(path.join(root, "docs/UPPER.MDX"));
  });
  it("does not enumerate an excluded dependency directory", () => {
    const root = fixture(); const read = fs.readdirSync.bind(fs);
    vi.spyOn(fs, "readdirSync").mockImplementation((directory, options) => {
      if (String(directory).split(path.sep).includes("node_modules")) throw new Error("excluded dependency traversal");
      return read(directory, options);
    });
    expect(collectDocExampleFiles(root).length).toBe(9);
  });
  it("keeps the literal parser and excludes variable/angle-bracket placeholders", () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, "README.md"), 'INITIAL_PASSWORD="explicit-example"\nINITIAL_PASSWORD=$VARIABLE\nINITIAL_PASSWORD=<replace>\n');
    expect([...scanDocExamples("INITIAL_PASSWORD", root).keys()].sort()).toEqual(["change-me", "explicit-example"]);
    expect([...scanDocExamples("JWT_SECRET", root).keys()]).toEqual(["replace-me"]);
  });
  it("follows eligible file entries through stat, without following directory symlinks", () => {
    const root = fixture(); const abs = path.join(root, "docs");
    vi.spyOn(fs, "readdirSync").mockImplementation((directory) => {
      expect(directory).toBe(abs);
      return [{ name: "link.md", isDirectory: () => false }, { name: "linked-directory", isDirectory: () => false }];
    });
    const stat = fs.statSync.bind(fs);
    vi.spyOn(fs, "statSync").mockImplementation((file) => file === path.join(abs, "link.md") ? { isFile: () => true } : stat(file));
    expect(collectDocExampleFiles(root, ["docs"])).toEqual([path.join(abs, "link.md")]);
  });
});
