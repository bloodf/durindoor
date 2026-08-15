import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { getPublicOrigin } = await import("../../src/lib/auth/oidc.js");

function request(headers = {}) {
  return new Request("http://durindoor.test/api/auth/oidc/start", { headers: { host: "durindoor.test", ...headers } });
}


const originalBaseUrl = process.env.BASE_URL;
const originalPublicBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;
beforeEach(() => {
  delete process.env.BASE_URL;
  delete process.env.NEXT_PUBLIC_BASE_URL;
});
afterEach(() => {
  if (originalBaseUrl === undefined) delete process.env.BASE_URL;
  else process.env.BASE_URL = originalBaseUrl;
  if (originalPublicBaseUrl === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
  else process.env.NEXT_PUBLIC_BASE_URL = originalPublicBaseUrl;
});
describe("OIDC public origin", () => {
  it("ignores hostile forwarded origin headers from an untrusted peer", () => {
    expect(getPublicOrigin(request({ "x-forwarded-host": "evil.test", "x-forwarded-proto": "https" }))).toBe("http://durindoor.test");
  });

  it("ignores forwarded origin headers even when host looks like a loopback proxy", () => {
    expect(getPublicOrigin(request({ "x-forwarded-host": "public.example", "x-forwarded-proto": "https" }))).toBe("http://durindoor.test");
  });

  it("gives validated BASE_URL precedence over every header", () => {
    const prior = process.env.BASE_URL;
    process.env.BASE_URL = "https://configured.example/";
    expect(getPublicOrigin(request({ "x-forwarded-host": "evil.test" }))).toBe("https://configured.example");
    if (prior === undefined) delete process.env.BASE_URL;
    else process.env.BASE_URL = prior;
  });

  it("falls back to the request URL when no configured origin is available", () => {
    expect(getPublicOrigin(request())).toBe("http://durindoor.test");
  });

  it("rejects a malformed configured origin instead of silently falling back", () => {
    const prior = process.env.BASE_URL;
    process.env.BASE_URL = "not-a-url";
    expect(() => getPublicOrigin(request({ "x-forwarded-host": "evil.test" }))).toThrow("Invalid OIDC public origin configuration");
    if (prior === undefined) delete process.env.BASE_URL;
    else process.env.BASE_URL = prior;
  });
});
