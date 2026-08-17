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

describe("hasTrustedLocalOrigin", () => {
  it("accepts loopback hostnames with IPv4, IPv6, and ports", async () => {
    const { hasTrustedLocalOrigin } = await import("../../src/lib/auth/requestOrigin.js");
    expect(hasTrustedLocalOrigin(request({ host: "localhost:20128", origin: "http://localhost:20128" }))).toBe(true);
    expect(hasTrustedLocalOrigin(request({ host: "127.0.0.1:20128", origin: "http://127.0.0.1:20128" }))).toBe(true);
    expect(hasTrustedLocalOrigin(request({ host: "[::1]:20128", origin: "http://[::1]:20128" }))).toBe(true);
  });

  it("rejects matching attacker host and Origin after DNS rebinding", async () => {
    const { hasTrustedLocalOrigin } = await import("../../src/lib/auth/requestOrigin.js");
    expect(hasTrustedLocalOrigin(request({ host: "evil.example:20128", origin: "http://evil.example:20128" }))).toBe(false);
  });
});

describe("hasExactRequestOrigin port and scheme strictness", () => {
  it("rejects an Origin whose port does not match the Host port", () => {
    expect(hasExactRequestOrigin(request({ host: "durindoor.test:20128", origin: "http://durindoor.test:20129" }))).toBe(false);
  });

  it("rejects an Origin whose scheme does not match the request scheme", () => {
    expect(hasExactRequestOrigin(request({ host: "durindoor.test", origin: "https://durindoor.test" }))).toBe(false);
  });

  it("allows a same-host HTTPS Origin when a TLS-terminating proxy sets x-forwarded-proto", () => {
    // Cloudflare tunnel / Tailscale Serve: socket is http, browser Origin is https.
    expect(hasExactRequestOrigin(request({ host: "llm.amoena.ai", origin: "https://llm.amoena.ai", "x-forwarded-proto": "https" }))).toBe(true);
  });

  it("uses the first hop when x-forwarded-proto lists multiple schemes", () => {
    expect(hasExactRequestOrigin(request({ host: "llm.amoena.ai", origin: "https://llm.amoena.ai", "x-forwarded-proto": "https, http" }))).toBe(true);
  });
});
