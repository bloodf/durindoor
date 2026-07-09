import { describe, it, expect, vi, afterEach } from "vitest";
import { KimiWebExecutor } from "../../open-sse/executors/kimi-web.js";

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

const CHAT_URL = "https://www.kimi.com/apiv2/kimi.gateway.chat.v1.ChatService/Chat";

afterEach(() => {
  vi.clearAllMocks();
});

function oversizedFrameStream() {
  // Connect frame header: flags + 32-bit big-endian length.
  // Declare a 256 MiB payload (>> MAX_FRAME_LEN) so decodeConnectFrame returns
  // consumed === -1, simulating an oversized upstream frame.
  const header = new Uint8Array([0, 0x10, 0x00, 0x00, 0x00]);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(header);
    },
  });
}

describe("kimi-web oversized frame handling", () => {
  it("fails fast on non-streaming oversized Connect frames without returning 200", async () => {
    proxyAwareFetch.mockResolvedValue(
      new Response(oversizedFrameStream(), {
        status: 200,
        headers: { "content-type": "application/connect-streaming" },
      })
    );

    const executor = new KimiWebExecutor();
    const { response } = await executor.execute({
      body: { model: "k2d6", messages: [{ role: "user", content: "hi" }] },
      credentials: { apiKey: "kimi-auth=eyJ.test" },
      stream: false,
    });

    expect(proxyAwareFetch).toHaveBeenCalledWith(CHAT_URL, expect.any(Object), null);
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text.toLowerCase()).toContain("oversized frame");
  });
});
