// Port of decolua/9router#5607 (data-only SSE): Responses upstreams that omit
// `event:` lines must still assemble, using the payload's own `type`.
import { describe, expect, it } from "vitest";
import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";

const dataOnly = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
const convert = (raw) => convertResponsesStreamToJson(new Response(raw).body);
const message = { id: "msg_1", type: "message", role: "assistant", content: [{ type: "output_text", text: "hi", annotations: [] }] };

describe("data-only Responses SSE (#5607)", () => {
  it("assembles output and usage from frames without event: lines", async () => {
    const raw =
      dataOnly({ type: "response.created", response: { id: "resp_1", created_at: 1700000000 } }) +
      dataOnly({ type: "response.output_item.done", output_index: 0, item: message }) +
      dataOnly({ type: "response.completed", response: { status: "completed", usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 } } });
    expect(await convert(raw)).toMatchObject({
      id: "resp_1", status: "completed", output: [message],
      usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
    });
  });

  it("still fails a frame that has neither an event line nor a payload type", async () => {
    const raw = dataOnly({ response: { status: "completed", output: [message] } });
    expect((await convert(raw)).status).not.toBe("completed");
  });
});
