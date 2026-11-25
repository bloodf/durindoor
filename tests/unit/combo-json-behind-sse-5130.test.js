// A forced-streaming member can answer with one whole JSON document labelled
// text/event-stream, sometimes with "data: [DONE]" glued to its last brace.
// No line starts with "data:", so the peek judged a real answer empty.
import { describe, it, expect } from "vitest";
import { peekStreamForContent } from "../../open-sse/utils/streamContentPeek.js";
import { handleComboChat } from "../../open-sse/services/combo.js";

const log = { info() {}, warn() {}, error() {}, debug() {} };

function sseResponse(chunks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
}

const peek = (chunks, options) => peekStreamForContent(sseResponse(chunks), 1000, options);
const chatDoc = (message, finish = "stop") =>
  JSON.stringify({ object: "chat.completion", choices: [{ index: 0, finish_reason: finish, message }] });
const GLUED = `${chatDoc({ role: "assistant", content: "ok" })}data: [DONE]\n\n`;

describe("JSON document behind an event-stream body (decolua/9router#5130)", () => {
  it("reads a chat.completion with a glued [DONE] as content and replays it unchanged", async () => {
    const result = await peek([GLUED]);
    expect(result.outcome).toBe("content");
    expect(await new Response(result.body).text()).toBe(GLUED);
  });

  it("reads a pretty-printed document split across chunks", async () => {
    const text = JSON.stringify(JSON.parse(chatDoc({ content: "ok" })), null, 2);
    expect((await peek([text.slice(0, 20), text.slice(20, 60), text.slice(60)])).outcome).toBe("content");
  });

  it.each([
    ["chat tool call", chatDoc({ content: null, tool_calls: [{ id: "c1", function: { name: "f", arguments: "{}" } }] }, "tool_calls")],
    ["Responses message", JSON.stringify({ object: "response", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }] })],
    ["Responses tool call", JSON.stringify({ object: "response", status: "completed", output: [{ type: "function_call", call_id: "c1", name: "f", arguments: "{}" }] })],
    ["wrapped Responses object", JSON.stringify({ type: "response.completed", response: { object: "response", output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }] } })],
    ["Anthropic text", JSON.stringify({ type: "message", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" })],
    ["Anthropic tool use", JSON.stringify({ type: "message", content: [{ type: "tool_use", id: "t1", name: "f", input: {} }], stop_reason: "tool_use" })],
  ])("counts a %s", async (_name, text) => {
    expect((await peek([text])).outcome).toBe("content");
  });

  it.each([
    ["empty chat answer", chatDoc({ role: "assistant", content: "" })],
    ["empty Responses output", JSON.stringify({ object: "response", status: "completed", output: [] })],
    ["empty Anthropic content", JSON.stringify({ type: "message", content: [], stop_reason: "end_turn" })],
    ["unparseable body", "{not json}"],
    ["unrelated document", JSON.stringify({ ok: true })],
  ])("keeps an %s empty", async (_name, text) => {
    expect((await peek([text])).outcome).toBe("empty");
  });

  it.each([
    ["chat content_filter", chatDoc({ content: "" }, "content_filter")],
    ["Anthropic refusal", JSON.stringify({ type: "message", content: [], stop_reason: "refusal" })],
    ["Responses content_filter", JSON.stringify({ object: "response", status: "incomplete", incomplete_details: { reason: "content_filter" }, output: [] })],
  ])("keeps a %s as a safety stop", async (_name, text) => {
    expect((await peek([text])).outcome).toBe("safety_stop");
  });

  it("reports the error carried by a failed Responses object", async () => {
    const result = await peek([JSON.stringify({ object: "response", status: "failed", error: { code: "server_error", message: "boom" }, output: [] })]);
    expect(result.outcome).toBe("empty");
    expect(result.streamError?.message).toBe("boom");
  });

  it("still detects an unavailable notice inside a document", async () => {
    const result = await peek(
      [chatDoc({ content: "This model is no longer available. Please switch to another model." })],
      { detectUnavailableNotice: true },
    );
    expect(result.outcome).toBe("unavailable_notice");
  });

  it("serves the first combo member instead of skipping it", async () => {
    const attempted = [];
    const response = await handleComboChat({
      body: { stream: false, messages: [{ role: "user", content: "hi" }] },
      models: ["p1/first", "p2/second"],
      handleSingleModel: async (_body, model) => {
        attempted.push(model);
        return sseResponse([GLUED]);
      },
      log, comboName: "json-behind-sse", comboStrategy: "fallback",
    });
    expect(attempted).toEqual(["p1/first"]);
    expect(await response.text()).toBe(GLUED);
  });
});
