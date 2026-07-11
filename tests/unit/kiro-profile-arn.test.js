import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KiroService } from "../../src/lib/oauth/services/kiro.js";

/**
 * Regression tests for Kiro API-key auth.
 *
 * KiroService.validateApiKey resolves a profileArn with the key (via
 * CodeWhisperer ListAvailableProfiles) and returns a credential shaped for
 * persistence with authMethod="api_key". The response profile field name
 * varies (`arn` vs `profileArn`) — both are accepted by listAvailableProfiles.
 *
 * Note: OAuth (Builder ID / IDC) profileArn resolution is handled upstream by
 * fetchKiroProfileArn in providers.js and is covered there — not here.
 */
describe("kiro API-key auth (KiroService.validateApiKey)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("validates an API key and resolves a credential with profileArn", async () => {
    const expectedArn = "arn:aws:codewhisperer:us-east-1:444:profile/KEY";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ profiles: [{ arn: expectedArn }] }),
    });

    const svc = new KiroService();
    const cred = await svc.validateApiKey("  my-secret-key  ");

    expect(cred).toEqual({
      accessToken: "my-secret-key",
      refreshToken: null,
      profileArn: expectedArn,
      region: "us-east-1",
      authMethod: "api_key",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://codewhisperer.us-east-1.amazonaws.com");
    expect(init.headers.Authorization).toBe("Bearer my-secret-key");
    expect(init.headers["x-amz-target"]).toBe(
      "AmazonCodeWhispererService.ListAvailableProfiles"
    );
  });

  it("rejects an empty API key without a network call", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const svc = new KiroService();
    await expect(svc.validateApiKey("   ")).rejects.toThrow("API key is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a validation error when the key is rejected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });
    const svc = new KiroService();
    await expect(svc.validateApiKey("bad-key")).rejects.toThrow(
      /API key validation failed/
    );
  });
});

// port(upstream): #2355 — Q-Dev IDC region tokens. listAvailableProfiles probes
// the requested region first, then the known Q Developer regions, because the
// profile can live in a different region than the IAM Identity Center.
describe("KiroService.listAvailableProfiles cross-region fallback (#2355)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const EU = "eu-central-1";
  const EUN = "eu-north-1";
  const arn = (r) => `arn:aws:codewhisperer:${r}:966063511238:profile/QN4AXVDKDEX7`;
  const ok = (profiles) => ({ ok: true, status: 200, json: async () => ({ profiles }) });
  const empty = { ok: true, status: 200, json: async () => ({ profiles: [] }) };
  const host = (url) => new URL(url).hostname;

  it("falls back preferred -> us-east-1 -> eu-central-1 in order and returns the eu-central ARN", async () => {
    const hosts = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      hosts.push(host(url));
      return url.includes(EU) ? ok([{ arn: arn(EU) }]) : empty;
    });
    const svc = new KiroService();
    expect(await svc.listAvailableProfiles("tok", EUN)).toBe(arn(EU));
    expect(hosts).toEqual([
      "q.eu-north-1.amazonaws.com",
      "codewhisperer.us-east-1.amazonaws.com",
      "q.eu-central-1.amazonaws.com",
    ]);
  });

  it("rejects an invalid region without any network call (SSRF guard)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const svc = new KiroService();
    await expect(svc.listAvailableProfiles("tok", "../../evil")).rejects.toThrow(/Invalid region/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
