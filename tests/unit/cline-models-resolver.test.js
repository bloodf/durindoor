import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

import { resolveClineModels } from "../../open-sse/services/clineModels.js";

const connection = { accessToken: "oauth-token" };

describe("resolveClineModels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLINE_LIVE_CATALOG = "true";
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CLINE_LIVE_CATALOG;
  });

  it("returns no models without an OAuth token and does not fetch", async () => {
    await expect(resolveClineModels({})).resolves.toEqual([]);
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("stays disabled by default until the OAuth contract is re-probed", async () => {
    delete process.env.CLINE_LIVE_CATALOG;

    await expect(resolveClineModels(connection)).resolves.toEqual([]);
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("uses WorkOS OAuth headers and the connection proxy", async () => {
    const proxyOptions = { connectionProxyUrl: "http://proxy.internal:8080" };
    mocks.proxyAwareFetch.mockResolvedValue({ ok: true, json: async () => [] });

    await resolveClineModels(connection, { proxyOptions });

    expect(mocks.proxyAwareFetch).toHaveBeenCalledWith(
      "https://api.cline.bot/api/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Accept: "application/json",
          Authorization: "Bearer workos:oauth-token",
        }),
      }),
      proxyOptions,
    );
  });

  it("aborts a stalled request after five seconds", async () => {
    vi.useFakeTimers();
    mocks.proxyAwareFetch.mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));

    const pending = resolveClineModels(connection);
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toEqual([]);
    expect(mocks.proxyAwareFetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it.each([
    ["a non-2xx response", { ok: false, json: vi.fn() }],
    ["a malformed response", { ok: true, json: async () => ({ models: [] }) }],
  ])("fails soft for %s", async (_case, response) => {
    mocks.proxyAwareFetch.mockResolvedValue(response);
    await expect(resolveClineModels(connection)).resolves.toEqual([]);
  });

  it("fails soft for network and parse errors", async () => {
    mocks.proxyAwareFetch.mockRejectedValueOnce(new Error("offline"));
    await expect(resolveClineModels(connection)).resolves.toEqual([]);

    mocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => { throw new SyntaxError("bad json"); },
    });
    await expect(resolveClineModels(connection)).resolves.toEqual([]);
  });

  it("normalizes array responses, rejects invalid and ClinePass IDs, and sorts by ID", async () => {
    mocks.proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { id: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash (Free)" },
        { id: 42, name: "invalid" },
        { id: "cline-pass/secret", name: "wrong provider" },
        { id: "anthropic/claude-sonnet", name: null },
      ],
    });

    await expect(resolveClineModels(connection)).resolves.toEqual([
      { id: "anthropic/claude-sonnet", name: "anthropic/claude-sonnet" },
      { id: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash (Free)" },
    ]);
  });

  it("normalizes object data responses", async () => {
    mocks.proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "openai/gpt-live", name: "GPT Live" }] }),
    });

    await expect(resolveClineModels(connection)).resolves.toEqual([
      { id: "openai/gpt-live", name: "GPT Live" },
    ]);
  });
});
