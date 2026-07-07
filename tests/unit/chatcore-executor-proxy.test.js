import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = { upstreamProxyConfig: {}, cliproxyapi_fallback_codes: "429,500,502,503,504" };
const calls = [];

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => settings),
}));

vi.mock("../../open-sse/executors/index.js", () => {
  const makeExecutor = (provider, extras = {}) => ({
    provider,
    noAuth: extras.noAuth ?? true,
    execute: vi.fn(async (input) => {
      calls.push({ provider, input });
      return {
        response: { status: 200, ok: true },
        url: `https://${provider}.example`,
        headers: {},
        transformedBody: input.body,
      };
    }),
    refreshCredentials: vi.fn(async () => null),
    ...extras,
  });
  const executors = {
    openai: makeExecutor("openai", { noAuth: false }),
    anthropic: makeExecutor("anthropic", { noAuth: false }),
    cliproxyapi: makeExecutor("cliproxyapi", { noAuth: true }),
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
  vi.clearAllMocks();
});

describe("chatCore upstream proxy resolver", () => {
  it("uses the native executor when no upstream proxy config exists", async () => {
    const executor = await resolveExecutorWithProxy("openai");
    expect(executor).toBe(getExecutor("openai"));
  });

  it("per-connection claude-native override selects CLIProxyAPI and applies model mapping", async () => {
    const executor = await resolveExecutorWithProxy("openai", undefined, {
      cliproxyapiMode: "claude-native",
      cliproxyapiModelMapping: { "gpt-4.1": "claude-sonnet-4.6" },
    });
    expect(executor.provider).toBe("cliproxyapi");
    expect(executor.noAuth).toBe(false);

    await executor.execute({
      model: "gpt-4.1",
      body: { model: "gpt-4.1", messages: [] },
      stream: true,
      credentials: {},
    });

    const mapped = calls.find((c) => c.provider === "cliproxyapi");
    expect(mapped.input.body.model).toBe("claude-sonnet-4.6");
  });

  it("maps models when dispatching through CLIProxyAPI passthrough mode", async () => {
    settings.upstreamProxyConfig.openai = { enabled: true, mode: "cliproxyapi", cliproxyapiModelMapping: { "gpt-4.1": "claude-sonnet-4.6" } };
    calls.length = 0;
    clearUpstreamProxyConfigCache();

    const executor = await resolveExecutorWithProxy("openai");
    await executor.execute({
      model: "gpt-4.1",
      body: { model: "gpt-4.1", messages: [] },
      stream: true,
      credentials: { apiKey: "sk-test" },
    });

    const mapped = calls.find((c) => c.provider === "cliproxyapi");
    expect(mapped.input.body.model).toBe("claude-sonnet-4.6");
  });

  it("fallback retries through CLIProxyAPI and applies sentinel model mapping", async () => {
    settings.upstreamProxyConfig.openai = { enabled: true, mode: "fallback" };
    settings.upstreamProxyConfig.cliproxyapi = { enabled: true, mode: "native", cliproxyapiModelMapping: { "gpt-4.1": "claude-sonnet-4.6" } };
    calls.length = 0;
    clearUpstreamProxyConfigCache();

    const openai = getExecutor("openai");
    openai.execute.mockImplementation(async () => ({
      response: { status: 429, ok: false },
      url: "https://openai.example",
      headers: {},
      transformedBody: {},
    }));

    const executor = await resolveExecutorWithProxy("openai");
    await executor.execute({
      model: "gpt-4.1",
      body: { model: "gpt-4.1" },
      stream: true,
      credentials: { apiKey: "sk-test" },
    });

    expect(openai.execute).toHaveBeenCalledTimes(1);
    const mapped = calls.find((c) => c.provider === "cliproxyapi");
    expect(mapped).toBeTruthy();
    expect(mapped.input.body.model).toBe("claude-sonnet-4.6");
  });

  it("inherits native noAuth and refreshCredentials on routed wrappers", async () => {
    const native = getExecutor("openai");
    native.noAuth = false;
    native.refreshCredentials.mockResolvedValue({ accessToken: "refreshed" });

    const executor = await resolveExecutorWithProxy("openai", undefined, {
      cliproxyapiMode: "claude-native",
    });
    expect(executor.noAuth).toBe(false);
    expect(typeof executor.refreshCredentials).toBe("function");
    await expect(executor.refreshCredentials({ refreshToken: "rt" })).resolves.toEqual({
      accessToken: "refreshed",
    });
  });

  it("direct cliproxyapi executor remains noAuth even when credentials are provided", async () => {
    const executor = getExecutor("cliproxyapi");
    expect(executor.noAuth).toBe(true);
  });
});
