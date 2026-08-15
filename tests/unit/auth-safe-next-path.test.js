import { describe, expect, it } from "vitest";
import { safeNextPath } from "../../src/lib/auth/safeNextPath.js";

describe("safeNextPath", () => {
  it("accepts internal root-relative paths", () => {
    expect(safeNextPath("/dashboard/usage?tab=requests")).toBe("/dashboard/usage?tab=requests");
  });

  it.each([null, "dashboard", "//evil.example", "/\\evil.example", "https://evil.example"]) (
    "rejects unsafe redirect %p",
    (value) => expect(safeNextPath(value)).toBe("/dashboard"),
  );
});
