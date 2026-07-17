import { describe, it, expect, vi, afterEach } from "vitest";
import { KimiWebExecutor } from "../../open-sse/executors/kimi-web.js";
import { frameConnectMessage } from "../../open-sse/executors/kimi-web.js";

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

const CHAT_URL = "https://www.kimi.com/apiv2/kimi.gateway.chat.v1.ChatService/Chat";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function framedResponseStream() {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(frameConnectMessage(JSON.stringify({ op: "set", mask: "block.text", block: { text: { content: "ok" } } })));
      controller.close();
    },
  });
}

describe("kimi-web proxy support", () => {
  it("uses proxyAwareFetch with the configured proxy when connectionProxyEnabled is true", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(framedResponseStream(), { status: 200, headers: { "content-type": "application/connect-streaming" } })
    );
    vi.stubGlobal("fetch", fetchSpy);

    proxyAwareFetch.mockResolvedValue(
      new Response(framedResponseStream(), { status: 200, headers: { "content-type": "application/connect-streaming" } })
    );

    const executor = new KimiWebExecutor();
    await executor.execute({
      body: { model: "k2d6", messages: [{ role: "user", content: "hi" }] },
      credentials: { apiKey: "kimi-auth=eyJ.test" },
      stream: false,
      proxyOptions: {
        connectionProxyEnabled: true,
        connectionProxyUrl: "http://127.0.0.1:8080",
      },
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      CHAT_URL,
      expect.objectContaining({ method: "POST" }),
      expect.objectContaining({
        connectionProxyEnabled: true,
        connectionProxyUrl: "http://127.0.0.1:8080",
      })
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still calls proxyAwareFetch (not bare fetch) when proxy is disabled", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(""));
    vi.stubGlobal("fetch", fetchSpy);

    proxyAwareFetch.mockResolvedValue(
      new Response(framedResponseStream(), { status: 200, headers: { "content-type": "application/connect-streaming" } })
    );

    const executor = new KimiWebExecutor();
    await executor.execute({
      body: { model: "k2d6", messages: [{ role: "user", content: "hi" }] },
      credentials: { apiKey: "kimi-auth=eyJ.test" },
      stream: false,
      proxyOptions: null,
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(proxyAwareFetch).toHaveBeenCalledWith(CHAT_URL, expect.objectContaining({ method: "POST" }), null);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
