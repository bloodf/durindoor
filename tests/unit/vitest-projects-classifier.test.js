import { describe, expect, it } from "vitest";
import { isIntegrationSource } from "../__baseline__/vitest-projects.mjs";

describe("Vitest project resource classification", () => {
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
