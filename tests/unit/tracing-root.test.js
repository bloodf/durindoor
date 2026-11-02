import { describe, expect, it } from "vitest";
import { resolveTracingRoot } from "../../tracing-root.mjs";

describe("resolveTracingRoot", () => {
  it("returns the project root outside workspace mode", () => {
    expect(resolveTracingRoot("/home/u/app", undefined)).toBe("/home/u/app");
  });
  it("uses the parent dir in workspace mode", () => {
    expect(resolveTracingRoot("/home/u/app", "workspace")).toBe("/home/u");
  });
  it("never resolves to the filesystem root (#1338)", () => {
    expect(resolveTracingRoot("/workspace", "workspace")).toBe("/workspace");
    expect(resolveTracingRoot("/app", "workspace")).toBe("/app");
  });
});
