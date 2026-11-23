import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn(async () => ({ status: 200, headers: { get: () => "" } })) }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({ cliproxyapi_url: "http://cliproxy.local:8317" })),
}));

const { CliproxyapiExecutor, clearCliproxyapiUrlCache } = await import("../../open-sse/executors/cliproxyapi.js");

describe("CLIProxyAPI Devin inference parity (#2034)", () => {
  beforeEach(() => {
    fetchMock.mockClear();
    clearCliproxyapiUrlCache();
  });
  afterEach(() => vi.restoreAllMocks());

  it("forwards reasoning and complete assistant/tool continuation unchanged", async () => {
    const messages = [
      { role: "user", content: "Compute 2+2" },
      {
        role: "assistant", reasoning_content: "I should calculate this.", content: null,
        tool_calls: [{ id: "call-1", type: "function", function: { name: "calculator", arguments: "{\"expression\":\"2+2\"}" } }],
      },
      { role: "tool", tool_call_id: "call-1", name: "calculator", content: "4" },
      { role: "assistant", content: "4" },
    ];
    const executor = new CliproxyapiExecutor();

    await executor.execute({
      model: "devin/fixture", body: { model: "devin/fixture", messages },
      stream: false, credentials: { apiKey: "fixture-proxy-key" },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://cliproxy.local:8317/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer fixture-proxy-key");
    expect(JSON.parse(init.body)).toMatchObject({ model: "devin/fixture", messages });
  });
});
