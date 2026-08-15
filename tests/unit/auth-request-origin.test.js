import { describe, expect, it } from "vitest";
import { hasExactRequestOrigin } from "../../src/lib/auth/requestOrigin.js";

function request(headers = {}) {
  return new Request("http://durindoor.test/api/auth/login", { headers: { host: "durindoor.test", ...headers } });
}

describe("hasExactRequestOrigin", () => {
  it("allows originless CLI requests and normalized matching browser origins", () => {
    expect(hasExactRequestOrigin(request())).toBe(true);
    expect(hasExactRequestOrigin(request({ origin: "http://DURINDOOR.test:80" }))).toBe(true);
  });

  it("rejects an attacker-controlled Origin despite forwarded headers", () => {
    expect(hasExactRequestOrigin(request({ origin: "https://evil.test", "x-forwarded-host": "evil.test", "x-forwarded-proto": "https" }))).toBe(false);
  });
});
