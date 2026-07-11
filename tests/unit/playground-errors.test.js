import { describe, expect, it } from "vitest";
import { sanitizeErrorText } from "../../src/lib/playground/errors.js";

describe("sanitizeErrorText", () => {
  it("strips HTML tags", () => {
    expect(sanitizeErrorText("<script>alert(1)</script>Oops <b>bad</b>"))
      .toBe("alert(1) Oops bad");
  });

  it("strips POSIX absolute paths", () => {
    expect(sanitizeErrorText("Boom at /home/cortexos/proj/src/x.js failed"))
      .toBe("Boom at failed");
  });

  it("strips Windows paths", () => {
    expect(sanitizeErrorText("Boom at C:\\Users\\me\\src\\x.js gone"))
      .toBe("Boom at gone");
  });

  it("drops stack-frame lines beginning with `at`", () => {
    const input = "Request failed\n    at handler (/home/cortexos/app/route.js:12:3)\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)";
    expect(sanitizeErrorText(input)).toBe("Request failed");
  });

  it("caps length at 200 chars including ellipsis", () => {
    const long = "x".repeat(500);
    const result = sanitizeErrorText(long);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.endsWith("…")).toBe(true);
  });

  it("returns empty string for nullish/empty input", () => {
    expect(sanitizeErrorText(null)).toBe("");
    expect(sanitizeErrorText("")).toBe("");
  });
});
