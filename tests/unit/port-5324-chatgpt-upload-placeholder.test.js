import { afterEach, describe, expect, it, vi } from "vitest";
import { __waitForImageViaWebSocketForTesting } from "../../open-sse/executors/chatgpt-web-http.js";

const CONVERSATION_ID = "conv-5324";
const FINAL_POINTER = "file-service://file-final-5324";

function frame(message) {
  return { data: JSON.stringify({ type: "conversation-update", payload: { conversation_id: CONVERSATION_ID, update_content: { message } } }) };
}

const imageMessage = (id, pointer, metadata) => ({
  id,
  author: { role: "tool" },
  content: { content_type: "multimodal_text", parts: [{ content_type: "image_asset_pointer", asset_pointer: pointer }] },
  ...(metadata ? { metadata } : null),
});

describe("upstream PR #5324 - ChatGPT Web upload placeholder", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["file-service://file_upload", "sediment://file_upload_1", "file_upload"])(
    "keeps waiting after the %s placeholder and returns only the real image",
    async (placeholder) => {
      let socket;
      vi.stubGlobal("WebSocket", class {
        constructor() { socket = this; }
        close() { this.onclose?.(); }
      });
      const wait = __waitForImageViaWebSocketForTesting("wss://chatgpt.invalid/ws", CONVERSATION_ID, 1000, {});
      await vi.waitFor(() => expect(socket?.onmessage).toBeTypeOf("function"));

      socket.onmessage(frame(imageMessage("placeholder", placeholder, { asset_pointer: placeholder })));
      socket.onmessage(frame(imageMessage("final", FINAL_POINTER)));

      const outcome = await wait;
      expect(outcome.pointers.map((entry) => entry.pointer)).toEqual([FINAL_POINTER]);
    },
  );
});
