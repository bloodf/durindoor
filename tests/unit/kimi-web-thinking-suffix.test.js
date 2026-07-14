import { describe, it, expect, vi, afterEach } from "vitest";
import { KimiWebExecutor } from "../../open-sse/executors/kimi-web.js";
import { KIMI_WEB_DISCOVERY_HEADERS } from "../../src/lib/providers/webCookieAuth.js";

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

afterEach(() => vi.clearAllMocks());

// Decode the framed Connect request body the executor sent to Kimi.
function decodeSentBody() {
  const [, init] = proxyAwareFetch.mock.calls[0];
  const bytes = init.body; // Uint8Array: 5-byte header + JSON
  const json = Buffer.from(bytes.slice(5)).toString("utf8");
  return JSON.parse(json);
}

describe("kimi-web thinking-suffix stripping", () => {
  it("resolves the thinking tier when the model carries a repo-wide effort suffix", async () => {
    proxyAwareFetch.mockResolvedValue(new Response(new ReadableStream({ start: (c) => c.close() }), { status: 200 }));
    const executor = new KimiWebExecutor();
    await executor.execute({
      body: { model: "k2d6-thinking(high)", messages: [{ role: "user", content: "hi" }] },
      credentials: { apiKey: "kimi-auth=eyJ.test" },
      stream: false,
    });
    const sent = decodeSentBody();
    // Without the suffix strip, resolveModelConfig falls through to the
    // non-thinking tier and options.thinking would be false.
    expect(sent.options.thinking).toBe(true);
  });

  it("still disables thinking when reasoning_effort is 'none' even with a suffix", async () => {
    proxyAwareFetch.mockResolvedValue(new Response(new ReadableStream({ start: (c) => c.close() }), { status: 200 }));
    const executor = new KimiWebExecutor();
    await executor.execute({
      body: { model: "k2d6-thinking(high)", messages: [{ role: "user", content: "hi" }], reasoning_effort: "none" },
      credentials: { apiKey: "kimi-auth=eyJ.test" },
      stream: false,
    });
    expect(decodeSentBody().options.thinking).toBe(false);
  });
});

describe("KIMI_WEB_DISCOVERY_HEADERS (shared probe/discovery header set)", () => {
  it("carries the www.kimi.com web-app fingerprint without embedding auth", () => {
    expect(KIMI_WEB_DISCOVERY_HEADERS.Origin).toBe("https://www.kimi.com");
    expect(KIMI_WEB_DISCOVERY_HEADERS.Referer).toBe("https://www.kimi.com/");
    expect(KIMI_WEB_DISCOVERY_HEADERS["connect-protocol-version"]).toBe("1");
    expect(KIMI_WEB_DISCOVERY_HEADERS["User-Agent"]).toContain("Mozilla/5.0");
    // Auth is added per-request, never baked into the shared constant.
    expect(KIMI_WEB_DISCOVERY_HEADERS.Authorization).toBeUndefined();
    expect(KIMI_WEB_DISCOVERY_HEADERS.Cookie).toBeUndefined();
  });
});
