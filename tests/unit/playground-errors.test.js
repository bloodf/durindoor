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

  it("strips any absolute POSIX path, not only allowlisted roots", () => {
    expect(sanitizeErrorText("leak /private/project/secret.js done"))
      .toBe("leak done");
    expect(sanitizeErrorText("leak /mnt/build/x.js done"))
      .toBe("leak done");
    expect(sanitizeErrorText("leak /custom/path done"))
      .toBe("leak done");
  });

  it("preserves URLs (does not strip scheme paths)", () => {
    expect(sanitizeErrorText("see https://example.com/api/v1/chat for docs"))
      .toBe("see https://example.com/api/v1/chat for docs");
  });

  it("strips Windows paths", () => {
    expect(sanitizeErrorText("Boom at C:\\Users\\me\\src\\x.js gone"))
      .toBe("Boom at gone");
  });

  it("strips punctuation-adjacent POSIX paths", () => {
    expect(sanitizeErrorText("failed (/private/x)")).toBe("failed ()");
    expect(sanitizeErrorText('err:"/etc/passwd"')).toBe('err:""');
    expect(sanitizeErrorText("path=/tmp/foo")).toBe("path=");
    expect(sanitizeErrorText("mid(/a/b)mid")).toBe("mid()mid");
  });

  it("preserves http and https URLs", () => {
    expect(sanitizeErrorText("see http://example.com/api for docs"))
      .toBe("see http://example.com/api for docs");
    expect(sanitizeErrorText("see https://example.com/api/v1/chat for docs"))
      .toBe("see https://example.com/api/v1/chat for docs");
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
