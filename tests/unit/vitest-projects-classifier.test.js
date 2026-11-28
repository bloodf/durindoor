import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFileClassifier, isIntegrationSource } from "../__baseline__/vitest-projects.mjs";

describe("Vitest project resource classification", () => {
  it("detects a listener in an imported helper without overrides", () => {
    const root = mkdtempSync(join(tmpdir(), "vitest-classifier-"));
    try {
      const tests = join(root, "tests");
      mkdirSync(tests);
      writeFileSync(join(tests, "sample.test.js"), 'import "./helper.js";');
      writeFileSync(join(tests, "helper.js"), "server.listen(0);");
      expect(createFileClassifier(tests, root)("sample.test.js")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("conservatively follows commented-out local imports", () => {
    const root = mkdtempSync(join(tmpdir(), "vitest-classifier-"));
    try {
      const tests = join(root, "tests");
      mkdirSync(tests);
      writeFileSync(join(tests, "sample.test.js"), '// import "./helper.js";');
      writeFileSync(join(tests, "helper.js"), "server.listen(0);");
      expect(createFileClassifier(tests, root)("sample.test.js")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("detects a listener after a regex literal containing comment delimiters", () => {
    expect(isIntegrationSource("const slash = /[//]/; server.listen(0);" )).toBe(true);
  });
  it("does not hide listeners after regex literals containing quote characters", () => {
    expect(isIntegrationSource('const slash = /[\"]/; server.listen(0); const x = "value";')).toBe(true);
  });
  it("ignores resource words in comments and string-only code", () => {
    expect(isIntegrationSource('// server.listen(0); new Worker()\nconst text = "server.listen(0); Worker";')).toBe(false);
    expect(isIntegrationSource(`const text = "from 'node:child_process'";`)).toBe(false);
  });
  it("handles template literals containing slashes", () => {
    expect(isIntegrationSource('const url = `https://example.com`; server.listen(0);')).toBe(true);
    expect(isIntegrationSource('const value = `${server.listen(0)}`;')).toBe(true);
  });
  it("parses JSX and fails closed on invalid source", () => {
    expect(isIntegrationSource('const view = <div>hello</div>;')).toBe(false);
    expect(isIntegrationSource('const = ;')).toBe(true);
  });
});
