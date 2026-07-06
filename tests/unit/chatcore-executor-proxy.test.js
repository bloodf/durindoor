import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = { upstreamProxyConfig: {}, cliproxyapi_fallback_codes: "429,500,502,503,504" };
const calls = [];

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => settings),
}));

vi.mock("../../open-sse/executors/index.js", () => {
  const makeExecutor = (provider) => ({
    provider,
    execute: vi.fn(async (input) => {
      calls.push({ provider, input });
      return { response: { status: 200 }, url: `mock://${provider}`, headers: {}, transformedBody: input.body };
    }),
  });
  const executors = {
    openai: makeExecutor("openai"),
    anthropic: makeExecutor("anthropic"),
    cliproxyapi: makeExecutor("cliproxyapi"),
  };
  return {
    getExecutor: vi.fn((provider) => executors[provider] || makeExecutor(provider)),
    __executors: executors,
  };
});

const { resolveExecutorWithProxy } = await import("../../open-sse/handlers/chatCore/executorProxy.js");
const { clearUpstreamProxyConfigCache } = await import("../../open-sse/handlers/chatCore/comboContextCache.js");
const { getExecutor } = await import("../../open-sse/executors/index.js");

beforeEach(() => {
  settings.upstreamProxyConfig = {};
  settings.cliproxyapi_fallback_codes = "429,500,502,503,504";
  calls.length = 0;
  clearUpstreamProxyConfigCache();
});

describe("chatCore upstream proxy resolver", () => {
  it("uses the native executor when no upstream proxy config exists", async () => {
    const executor = await resolveExecutorWithProxy("openai");
    expect(executor).toBe(getExecutor("openai"));
  });

  it("per-connection claude-native override selects CLIProxyAPI", async () => {
    settings.upstreamProxyConfig.openai = { enabled: true, mode: "native" };
    const executor = await resolveExecutorWithProxy("openai", undefined, {
      cliproxyapiMode: "claude-native",
    });
    expect(executor).toBe(getExecutor("cliproxyapi"));
  });

  it("maps models when dispatching through CLIProxyAPI passthrough mode", async () => {
    settings.upstreamProxyConfig.openai = {
      enabled: true,
      mode: "cliproxyapi",
      cliproxyapiModelMapping: { "gpt-4.1": "claude-sonnet-4.6" },
    };

    const executor = await resolveExecutorWithProxy("openai");
    await executor.execute({
      model: "gpt-4.1",
      body: { model: "gpt-4.1", messages: [] },
      stream: true,
      credentials: {},
    });

    expect(calls[0]).toMatchObject({
      provider: "cliproxyapi",
      input: {
        model: "claude-sonnet-4.6",
        body: { model: "claude-sonnet-4.6", messages: [] },
      },
    });
  });

  it("fallback retries through CLIProxyAPI and applies sentinel model mapping", async () => {
    settings.upstreamProxyConfig.openai = { enabled: true, mode: "fallback" };
    settings.upstreamProxyConfig.cliproxyapi = {
      enabled: true,
      mode: "native",
      cliproxyapiModelMapping: { "gpt-4.1": "claude-sonnet-4.6" },
    };
    getExecutor("openai").execute.mockResolvedValueOnce({
      response: { status: 503 },
      url: "mock://openai",
      headers: {},
      transformedBody: {},
    });

    const executor = await resolveExecutorWithProxy("openai");
    await executor.execute({
      model: "gpt-4.1",
      body: { model: "gpt-4.1" },
      stream: false,
      credentials: {},
    });

    expect(calls.at(-1)).toMatchObject({
      provider: "cliproxyapi",
      input: { model: "claude-sonnet-4.6" },
    });
  });
});
