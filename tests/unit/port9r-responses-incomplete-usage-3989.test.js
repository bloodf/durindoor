// Port of the Responses-API pieces of decolua/9router#3989 that DurinDoor lacked:
//  - a forced-SSE -> JSON Responses conversion keeps incomplete_details when the
//    upstream ended with response.incomplete;
//  - Responses-shaped usage keeps total_tokens through filterUsageForFormat.
import { describe, expect, it } from "vitest";
import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";
import { filterUsageForFormat } from "../../open-sse/utils/usageTracking.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

function sseStream(events) {
  const enc = new TextEncoder();
  const text = events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(text));
      controller.close();
    },
  });
}

describe("port9r #3989 stream -> JSON response.incomplete", () => {
  it("surfaces incomplete_details and usage of a capped response", async () => {
    const response = {
      id: "resp_1",
      created_at: 1,
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [],
      usage: { input_tokens: 20, output_tokens: 1, total_tokens: 21 },
    };
    const json = await convertResponsesStreamToJson(sseStream([
      ["response.created", { type: "response.created", response: { id: "resp_1", created_at: 1, status: "in_progress" } }],
      ["response.incomplete", { type: "response.incomplete", response }],
    ]));
    expect(json.status).toBe("incomplete");
    expect(json.incomplete_details).toEqual({ reason: "max_output_tokens" });
    expect(json.usage).toMatchObject({ input_tokens: 20, output_tokens: 1, total_tokens: 21 });
  });

  it("omits incomplete_details on a completed response", async () => {
    const json = await convertResponsesStreamToJson(sseStream([
      ["response.completed", { type: "response.completed", response: { id: "resp_2", created_at: 1, status: "completed", output: [], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }],
    ]));
    expect(json.status).toBe("completed");
    expect(json).not.toHaveProperty("incomplete_details");
  });
});

describe("port9r #3989 Responses usage keeps total_tokens", () => {
  it("does not drop total_tokens for the Responses wire format", () => {
    const out = filterUsageForFormat({ input_tokens: 5, output_tokens: 7, total_tokens: 12 }, FORMATS.OPENAI_RESPONSES);
    expect(out).toMatchObject({ input_tokens: 5, output_tokens: 7, total_tokens: 12 });
  });
});
