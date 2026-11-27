import { describe, it, expect, vi, beforeEach } from "vitest";

// 9router PR #1823: Kiro ListAvailableModels answers an expired bearer token
// with 403 "The bearer token included in the request is invalid". Live model
// discovery must refresh and retry on that 403, as it already did on 401.

const refreshKiroToken = vi.fn();
const proxyAwareFetch = vi.fn();

vi.mock("../../open-sse/services/tokenRefresh.js", () => ({ refreshKiroToken }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));
vi.mock("fs/promises", () => ({
  readdir: vi.fn(async () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); }),
  readFile: vi.fn(async () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); }),
}));

const { resolveKiroModels, isRefreshableKiroAuthError } = await import("../../open-sse/services/catalogs/kiroModels.js");

const BEARER_403 = '{"message":"The bearer token included in the request is invalid.","reason":null}';

function textResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

const CATALOG = JSON.stringify({ models: [{ modelId: "claude-sonnet-4", modelName: "Claude Sonnet 4" }] });

function credentials(tag) {
  return {
    accessToken: `expired-${tag}`,
    refreshToken: `refresh-${tag}`,
    providerSpecificData: {
      authMethod: "social",
      profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/ABC",
    },
  };
}

describe("Kiro model discovery refreshes on invalid-bearer 403 (9router #1823)", () => {
  beforeEach(() => {
    refreshKiroToken.mockReset();
    proxyAwareFetch.mockReset();
  });

  it("classifies 401 and the invalid-bearer 403 as refreshable, other 403s as not", () => {
    expect(isRefreshableKiroAuthError({ status: 401 })).toBe(true);
    expect(isRefreshableKiroAuthError({ status: 403, body: BEARER_403 })).toBe(true);
    expect(isRefreshableKiroAuthError({ status: 403, body: '{"message":"User is not authorized"}' })).toBe(false);
    expect(isRefreshableKiroAuthError({ status: 500, body: BEARER_403 })).toBe(false);
    expect(isRefreshableKiroAuthError(null)).toBe(false);
  });

  it("refreshes the token, persists it, and retries after a 403 invalid bearer token", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(textResponse(403, BEARER_403))
      .mockResolvedValueOnce(textResponse(200, CATALOG));
    refreshKiroToken.mockResolvedValue({ accessToken: "fresh-token", refreshToken: "fresh-refresh", expiresIn: 3600 });
    const onCredentialsRefreshed = vi.fn();

    const result = await resolveKiroModels(credentials("a"), { forceRefresh: true, onCredentialsRefreshed });

    expect(refreshKiroToken).toHaveBeenCalledTimes(1);
    expect(onCredentialsRefreshed).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "fresh-token" }));
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(proxyAwareFetch.mock.calls[1][1].headers.Authorization).toBe("Bearer fresh-token");
    expect(result?.models?.length).toBeGreaterThan(0);
  });

  it("does not refresh on an unrelated 403", async () => {
    proxyAwareFetch.mockResolvedValueOnce(textResponse(403, '{"message":"User is not authorized"}'));

    const result = await resolveKiroModels(credentials("b"), { forceRefresh: true });

    expect(refreshKiroToken).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
