import { afterEach, describe, expect, it } from "vitest";
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

describe("hasExactRequestOrigin port and proxy termination", () => {
  it("rejects an Origin whose port does not match the Host port", () => {
    expect(hasExactRequestOrigin(request({ host: "durindoor.test:20128", origin: "http://durindoor.test:20129" }))).toBe(false);
  });

  it("accepts a same-host HTTPS Origin when a proxy terminates TLS (scheme-independent)", () => {
    // Tailscale Serve / reverse proxy: browser Origin is https, upstream socket is
    // http, but the Host header is preserved -> same host:port -> same-origin.
    expect(hasExactRequestOrigin(request({ host: "durindoor.test", origin: "https://durindoor.test" }))).toBe(true);
  });

  it("accepts a Tailscale Serve HTTPS Origin on a non-default port with matching Host", () => {
    expect(hasExactRequestOrigin(request({ host: "cortexos.tailfd052e.ts.net:11434", origin: "https://cortexos.tailfd052e.ts.net:11434" }))).toBe(true);
  });

  it("accepts direct IP access over http (Tailscale/LAN address, same host:port)", () => {
    expect(hasExactRequestOrigin(request({ host: "100.109.20.9:11434", origin: "http://100.109.20.9:11434" }))).toBe(true);
  });

  it("rejects an HTTPS Origin whose host differs from the Host header", () => {
    // Implicit :443 origin vs :11434 Host -> different port -> not same-origin.
    expect(hasExactRequestOrigin(request({ host: "cortexos.tailfd052e.ts.net:11434", origin: "https://evil.ts.net" }))).toBe(false);
  });

  it("allows a browser Origin matching the configured public BASE_URL when a proxy rewrites Host", () => {
    // Fallback path for proxies that rewrite Host to an internal name.
    process.env.BASE_URL = "https://llm.amoena.ai";
    expect(hasExactRequestOrigin(request({ host: "127.0.0.1:11434", origin: "https://llm.amoena.ai" }))).toBe(true);
  });

  it("honors NEXT_PUBLIC_BASE_URL when BASE_URL is unset", () => {
    process.env.NEXT_PUBLIC_BASE_URL = "https://llm.amoena.ai";
    expect(hasExactRequestOrigin(request({ host: "127.0.0.1:11434", origin: "https://llm.amoena.ai" }))).toBe(true);
  });

  it("still rejects an Origin that matches neither the Host nor the configured base URL", () => {
    process.env.BASE_URL = "https://llm.amoena.ai";
    expect(hasExactRequestOrigin(request({ host: "127.0.0.1:11434", origin: "https://attacker.test" }))).toBe(false);
  });
});

afterEach(() => {
  delete process.env.BASE_URL;
  delete process.env.NEXT_PUBLIC_BASE_URL;
});
