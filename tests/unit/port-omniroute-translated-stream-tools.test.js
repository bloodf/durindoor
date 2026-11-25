import { describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock("@/lib/db/repos/sessionCaptureRepo.js", async (original) => ({ ...await original(), storeAdmittedCapture: store }));
import { prepareMessageCapture } from "@/sse/utils/messageCapture.js";
import { FORMATS } from "open-sse/translator/formats.js";

describe("OmniRoute e0e77edbf87ce8678e0e0fc37b94be4dcb1b5175 translated Claude stream tools", () => {
  it("stores the client-visible tool name without changing the event stream", async () => {
    const request = new Request("http://localhost/v1/messages", { headers: { "x-durindoor-capture": "true", "x-durindoor-capture-session": "550e8400-e29b-41d4-a716-446655440000" } });
    const capture = prepareMessageCapture({ request, body: { messages: [{ role: "user", content: "hello" }] }, settings: { enableSessionCapture: true }, auth: { ok: true, stored: true, apiKeyId: "key-id" }, credential: "secret-value", format: FORMATS.CLAUDE });
    const events = [
      { type: "message_start", message: { role: "assistant", content: [] } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool-id", name: "lookup", input: {} } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" } },
      { type: "message_stop" },
    ].map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
    const response = capture(new Response(events, { headers: { "content-type": "text/event-stream" } }));
    expect(await response.text()).toBe(events);
    expect(store).toHaveBeenCalledOnce();
    expect(JSON.parse(store.mock.calls[0][0].content)).toEqual({ user: ["hello"], assistant: [], toolNames: ["lookup"] });
  });
});
