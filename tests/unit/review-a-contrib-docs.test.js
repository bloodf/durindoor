import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(process.cwd(), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

describe("contributor documentation drift (#2294)", () => {
  it("keeps CLAUDE build and test commands aligned with pnpm and the declared Node engine", () => {
    const guide = read("CLAUDE.md");
    const packageJson = JSON.parse(read("package.json"));
    expect(packageJson.engines.node).toBe(">=24.22.2 <25");
    expect(guide).toContain("Node.js 24.22.2");
    expect(guide).toContain("pnpm run build");
    expect(guide).toContain("pnpm run test:ci");
    expect(guide).not.toMatch(/\bnpm (?:install|run (?:build|dev|test:ci))/);
  });

  it("requires real provider tests to use an explicit data directory copy", () => {
    const testSource = read("tests/translator/real/all-formats.real.test.js");
    const contributorGuide = read("AGENTS.md");
    const testingGuide = read("internal/docs/testing.mdx");
    expect(testSource).toContain("RUN_REAL=1 requires DATA_DIR");
    expect(testSource).toContain('path.join(process.env.DATA_DIR, "db", "data.sqlite")');
    expect(testSource).not.toContain('os.homedir(), ".9router"');
    expect(contributorGuide).toContain("disposable copy of the data directory");
    expect(testingGuide).toContain("disposable copy of your data directory");
  });

  it("indexes every top-level internal Markdown document", () => {
    const docs = path.join(root, "internal/docs");
    const readme = read("internal/docs/README.md");
    const listed = new Set([...readme.matchAll(/\]\(\.\/([^)#]+)\)/g)].map((match) => match[1]));
    const markdown = fs.readdirSync(docs).filter((name) => /\.mdx?$/.test(name) && name !== "README.md");
    expect(markdown.filter((name) => !listed.has(name))).toEqual([]);
  });

  it("marks old rewrite verification historical and identifies canonical overlapping docs", () => {
    expect(read("internal/docs/documentation-verification.md")).toContain("Historical report:");
    expect(read("internal/docs/connection-circuit-1108-draft.md")).toContain("Canonical acceptance evidence:");
    for (const file of ["upstream-port-1072.md", "upstream-1072-provider-intake.md", "upstream-intake-1148.md"]) {
      expect(read(`internal/docs/${file}`)).toContain("Canonical intake workflow");
    }
  });

  it("keeps gate policy canonical in AGENTS and links to it from companion guides", () => {
    expect(read("AGENTS.md")).toContain("## Local gate authority");
    expect(read("internal/docs/testing.mdx")).toContain("../../AGENTS.md#local-gate-authority");
    expect(read("internal/docs/local-ci.md")).toContain("../../AGENTS.md#local-gate-authority");
    expect(read("internal/docs/testing.mdx")).not.toContain("Docs-only Markdown paths use lint/docs/baseline checks");
  });
});
