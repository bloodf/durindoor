import { afterEach, describe, expect, it } from "vitest";
import { hasTrustedPeerHeaders } from "../../src/lib/auth/trustedPeer.js";

const original = process.env.NINEROUTER_PEER_TOKEN;
const req = (token) => new Request("http://localhost/", { headers: token === undefined ? {} : { "x-9r-peer-token": token } });

describe("hasTrustedPeerHeaders", () => {
  afterEach(() => {
    if (original === undefined) delete process.env.NINEROUTER_PEER_TOKEN;
    else process.env.NINEROUTER_PEER_TOKEN = original;
  });

  it("accepts only the exact per-process peer token", () => {
    process.env.NINEROUTER_PEER_TOKEN = "peer-secret-1234";
    expect(hasTrustedPeerHeaders(req("peer-secret-1234"))).toBe(true);
    expect(hasTrustedPeerHeaders(req("peer-secret-1235"))).toBe(false);
    expect(hasTrustedPeerHeaders(req("peer-secret"))).toBe(false);
    expect(hasTrustedPeerHeaders(req(""))).toBe(false);
    expect(hasTrustedPeerHeaders(req())).toBe(false);
  });

  it("rejects every request when no peer token is configured", () => {
    delete process.env.NINEROUTER_PEER_TOKEN;
    expect(hasTrustedPeerHeaders(req(""))).toBe(false);
    expect(hasTrustedPeerHeaders(req("anything"))).toBe(false);
  });

  it("compares in constant time", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../../src/lib/auth/trustedPeer.js", import.meta.url), "utf8");
    expect(source).toContain("timingSafeCompare(");
    expect(source).not.toMatch(/===\s*token/);
  });
});
