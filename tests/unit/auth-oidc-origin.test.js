import { describe, expect, it } from "vitest";

const { getPublicOrigin } = await import("../../src/lib/auth/oidc.js");

function request(headers = {}) {
  return new Request("http://durindoor.test/api/auth/oidc/start", { headers: { host: "durindoor.test", ...headers } });
}

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
});
