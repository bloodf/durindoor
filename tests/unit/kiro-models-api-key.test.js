import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

import {
  clearKiroModelCache,
  resolveKiroModels,
} from "../../open-sse/services/kiroModels.js";

const catalogResponse = () => ({
  ok: true,
  status: 200,
  json: async () => ({
    models: [{
      modelId: "claude-opus-5",
      modelName: "Claude Opus 5",
      tokenLimits: { maxInputTokens: 1_000_000, maxOutputTokens: 128_000 },
    }],
  }),
});

describe("Kiro API-key model discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearKiroModelCache();
    mocks.proxyAwareFetch.mockImplementation(async () => catalogResponse());
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes outer abort listener after Kiro model fetch settles successfully", async () => {
    const outer = new AbortController();
    const assertClean = (() => {
      const add = vi.spyOn(outer.signal, "addEventListener");
      const remove = vi.spyOn(outer.signal, "removeEventListener");
      return () => expect(remove).toHaveBeenCalledTimes(add.mock.calls.length);
    })();

    await resolveKiroModels({
      accessToken: "kiro-api-key",
      providerSpecificData: { authMethod: "api_key", region: "us-west-2" },
    }, { forceRefresh: true, signal: outer.signal });

    assertClean();
  });

  it("settles Kiro fetch when a forwarding signal cannot remove listeners", async () => {
    const signal = {
      aborted: false,
      reason: undefined,
      addEventListener: vi.fn(),
    };

    await expect(resolveKiroModels({
      accessToken: "kiro-api-key",
      providerSpecificData: { authMethod: "api_key", region: "us-west-2" },
    }, { forceRefresh: true, signal })).resolves.toMatchObject({ models: expect.any(Array) });

    expect(signal.addEventListener).toHaveBeenCalledTimes(1);
  });

  it("removes outer abort listener after Kiro model fetch rejects", async () => {
    const outer = new AbortController();
    const assertClean = (() => {
      const add = vi.spyOn(outer.signal, "addEventListener");
      const remove = vi.spyOn(outer.signal, "removeEventListener");
      return () => expect(remove).toHaveBeenCalledTimes(add.mock.calls.length);
    })();
    mocks.proxyAwareFetch.mockImplementationOnce(async () => {
      throw new Error("network failure");
    });

    await resolveKiroModels({
      accessToken: "kiro-api-key",
      providerSpecificData: { authMethod: "api_key", region: "us-west-2" },
    }, { forceRefresh: true, signal: outer.signal });

    assertClean();
  });

  it("forwards outer abort reason to Kiro controller while cleaning up listener", async () => {
    const outer = new AbortController();
    const assertClean = (() => {
      const add = vi.spyOn(outer.signal, "addEventListener");
      const remove = vi.spyOn(outer.signal, "removeEventListener");
      return () => expect(remove).toHaveBeenCalledTimes(add.mock.calls.length);
    })();
    let capturedSignal;
    mocks.proxyAwareFetch.mockImplementationOnce((_url, init) => new Promise((resolve, reject) => {
      capturedSignal = init.signal;
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    }));

    const pending = resolveKiroModels({
      accessToken: "kiro-api-key",
      providerSpecificData: { authMethod: "api_key", region: "us-west-2" },
    }, { forceRefresh: true, signal: outer.signal });
    const reason = new Error("caller aborted");
    outer.abort(reason);
    await pending;
    expect(capturedSignal.reason).toBe(reason);
    assertClean();
  });

  it("removes outer abort listener after Kiro fetch times out", async () => {
    vi.useFakeTimers();
    const outer = new AbortController();
    const add = vi.spyOn(outer.signal, "addEventListener");
    const remove = vi.spyOn(outer.signal, "removeEventListener");
    mocks.proxyAwareFetch.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    }));

    const pending = resolveKiroModels({
      accessToken: "kiro-api-key",
      providerSpecificData: { authMethod: "api_key", region: "us-west-2" },
    }, { forceRefresh: true, signal: outer.signal });
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(pending).resolves.toBeNull();
    expect(remove).toHaveBeenCalledTimes(add.mock.calls.length);
  });

  it("forwards already-aborted Kiro caller reason without registering a listener", async () => {
    const outer = new AbortController();
    const add = vi.spyOn(outer.signal, "addEventListener");
    const remove = vi.spyOn(outer.signal, "removeEventListener");
    const reason = new Error("aborted before call");
    outer.abort(reason);
    let capturedSignal;
    mocks.proxyAwareFetch.mockImplementationOnce(async (_url, init) => {
      capturedSignal = init.signal;
      return catalogResponse();
    });
    await resolveKiroModels({
      accessToken: "kiro-api-key",
      providerSpecificData: { authMethod: "api_key", region: "us-west-2" },
    }, { forceRefresh: true, signal: outer.signal });

    expect(capturedSignal.reason).toBe(reason);
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("sends TokenType only for api_key auth and preserves maxOutputTokens on every variant", async () => {
    const apiKeyResult = await resolveKiroModels({
      accessToken: "kiro-api-key",
      providerSpecificData: { authMethod: "api_key", region: "us-west-2" },
    }, { forceRefresh: true });

    await resolveKiroModels({
      accessToken: "kiro-social-token",
      providerSpecificData: { authMethod: "social", region: "us-west-2" },
    }, { forceRefresh: true });

    expect(mocks.proxyAwareFetch.mock.calls[0][1].headers).toMatchObject({
      Authorization: "Bearer kiro-api-key",
      TokenType: "API_KEY",
    });
    expect(mocks.proxyAwareFetch.mock.calls[1][1].headers).not.toHaveProperty("TokenType");
    expect(apiKeyResult.models).toHaveLength(4);
    expect(apiKeyResult.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "claude-opus-5",
          contextLength: 1_000_000,
          maxOutputTokens: 128_000,
        }),
      ])
    );
    expect(apiKeyResult.models.every((model) => model.maxOutputTokens === 128_000)).toBe(true);
  });
});
