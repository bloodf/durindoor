import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { sanitizeHeaders } = require("../../src/mitm/sanitizeHeaders.js");

describe("MITM sanitizeHeaders", () => {
  it("fully redacts set-cookie response headers", () => {
    const out = sanitizeHeaders({ "Set-Cookie": "session=abc123DEF; Path=/; HttpOnly" });
    expect(out["set-cookie"]).toBe("[REDACTED]");
    expect(JSON.stringify(out)).not.toContain("abc123DEF");
  });

  it("redacts arrays of set-cookie values", () => {
    const out = sanitizeHeaders({
      "set-cookie": ["sid=s3cr3tValue; HttpOnly", "csrf=t0kenValue; Secure"],
    });
    expect(out["set-cookie"]).toBe("[REDACTED]");
    expect(JSON.stringify(out)).not.toMatch(/s3cr3tValue|t0kenValue/);
  });

  it("masks known secret headers even when values do not match typical token patterns", () => {
    const out = sanitizeHeaders({
      authorization: "Basic abc",
      cookie: "sid=abc123",
      "x-api-key": "test-key",
      "content-type": "application/json",
    });
    expect(out.authorization).toBe("[REDACTED]");
    expect(out.cookie).toBe("[REDACTED]");
    expect(out["x-api-key"]).toBe("[REDACTED]");
    expect(out["content-type"]).toBe("application/json");
  });
});
