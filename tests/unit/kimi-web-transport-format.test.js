import { describe, it, expect, vi, afterEach } from "vitest";
import { KimiWebExecutor } from "../../open-sse/executors/kimi-web.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { frameConnectMessage } from "../../open-sse/executors/kimi-web.js";

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

const CHAT_URL = "https://www.kimi.com/apiv2/kimi.gateway.chat.v1.ChatService/Chat";

async function* streamFramedMessages(messages) {
  for (const msg of messages) {
    yield frameConnectMessage(JSON.stringify(msg));
  }
}

function framedStream(messages) {
  const iterator = streamFramedMessages(messages);
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
  });
}

function collectSseChunks(response) {
  const reader = response.body.getReader();
  const chunks = [];
  const decoder = new TextDecoder();
  return new Promise((resolve) => {
    function read() {
      reader.read().then(({ done, value }) => {
        if (done) {
          resolve(chunks);
          return;
        }
        chunks.push(decoder.decode(value, { stream: true }));
        read();
      });
    }
    read();
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("kimi-web transport format", () => {
  it("registers kimi-web as openai wire format so passthrough paths run", () => {
    expect(PROVIDERS["kimi-web"].format).toBe("openai");
    expect(PROVIDERS["kimi-web"].executor).toBe("kimi-web");
  });

  it("streaming output includes data: [DONE] for OpenAI clients", async () => {
    const jwt = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJ1c2VyIn0.signature";
    proxyAwareFetch.mockResolvedValue(
      new Response(framedStream([{ op: "set", mask: "block.text", block: { text: { content: "hi" } } }]), {
        status: 200,
        headers: { "content-type": "application/connect-streaming" },
      })
    );

    const executor = new KimiWebExecutor();
    const { response } = await executor.execute({
      body: { model: "k2d6", messages: [{ role: "user", content: "hello" }] },
      credentials: { apiKey: `kimi-auth=${jwt}` },
      stream: true,
    });

    expect(proxyAwareFetch).toHaveBeenCalledWith(
      CHAT_URL,
      expect.objectContaining({ method: "POST" }),
      null
    );

    const chunks = await collectSseChunks(response);
    const text = chunks.join("");
    expect(text).toContain('data: {"id":"chatcmpl-');
    expect(text).toContain('"object":"chat.completion.chunk"');
    expect(text).toContain('"delta":{"content":"hi"}');
    expect(text).toContain("data: [DONE]\n\n");
  });
});
