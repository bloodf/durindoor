import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({ cliproxyapi_url: "http://cliproxy.local:8317" })),
}));

const fetchMock = vi.fn(async () => ({ status: 200, headers: { get: () => "" } }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const {
  CliproxyapiExecutor,
  clearCliproxyapiUrlCache,
  isCliproxyapiDeepModeEnabled,
} = await import("../../open-sse/executors/cliproxyapi.js");

const originalEnv = {
  BASE_URL: process.env.BASE_URL,
  OMNIROUTE_PROVIDER_MANIFEST_URL: process.env.OMNIROUTE_PROVIDER_MANIFEST_URL,
};

beforeEach(() => {
  fetchMock.mockClear();
  clearCliproxyapiUrlCache();
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("CliproxyapiExecutor", () => {
  it("detects per-connection deep mode", () => {
    expect(isCliproxyapiDeepModeEnabled({ cliproxyapiMode: "claude-native" })).toBe(true);
    expect(isCliproxyapiDeepModeEnabled({ cliproxyapiMode: "native" })).toBe(false);
  });

  it("dispatches through configured CLIProxyAPI URL with manifest header", async () => {
    process.env.OMNIROUTE_PROVIDER_MANIFEST_URL = "https://durindoor.example/api/v1/provider-plugin-manifest";
    const executor = new CliproxyapiExecutor();

    await executor.execute({
      model: "gpt-4.1",
      body: { messages: [] },
      stream: true,
      credentials: { apiKey: "sk-test" },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://cliproxy.local:8317/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
    expect(init.headers["X-OmniRoute-Provider-Manifest-Url"])
      .toBe("https://durindoor.example/api/v1/provider-plugin-manifest");
    expect(JSON.parse(init.body).model).toBe("gpt-4.1");
  });

  it("does not route local sidecar dispatch through provider proxy options", async () => {
    const executor = new CliproxyapiExecutor();

    await executor.execute({
      model: "gpt-4.1",
      body: { messages: [] },
      stream: false,
      credentials: { apiKey: "sk-test" },
      proxyOptions: { type: "vercel-relay", proxyUrl: "https://relay.example" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toHaveLength(2);
  });

  it("ignores untrusted inbound Origin when building the manifest header", async () => {
    process.env.BASE_URL = "https://durindoor.example";
    const executor = new CliproxyapiExecutor();

    await executor.execute({
      model: "gpt-4.1",
      body: { messages: [] },
      stream: true,
      credentials: {
        apiKey: "sk-test",
        rawHeaders: { origin: "https://attacker.example" },
      },
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["X-OmniRoute-Provider-Manifest-Url"])
      .toBe("https://durindoor.example/api/v1/provider-plugin-manifest");
  });
});
