import { beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(() => {
  fetchMock.mockClear();
  clearCliproxyapiUrlCache();
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
    delete process.env.OMNIROUTE_PROVIDER_MANIFEST_URL;
  });
});
