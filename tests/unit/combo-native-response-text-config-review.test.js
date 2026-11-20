import { describe, expect, it } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

// Review fixture for #1072 (residual on #2070): a native Responses envelope
// may carry the request's text CONFIGURATION next to its native output —
// {"text":{"format":{"type":"json_schema"}}} is metadata, not assistant
// content. The combo emptiness classifier must read the native output items
// and the envelope status, never that configuration object.

const log = { info() {}, warn() {}, error() {}, debug() {} };

const IMAGE_CALL = { type: "image_generation_call", id: "img_1", result: "c3ludGhldGlj" };
const TEXT_CONFIG = { format: { type: "json_schema", name: "answer", schema: { type: "object" } } };

async function run(first, second = { text: "fallback" }) {
  const attempted = [];
  const response = await handleComboChat({
    body: { stream: false, messages: [{ role: "user", content: "hello" }] },
    models: ["p1/first", "p2/second"],
    handleSingleModel: async (_body, model) => {
      attempted.push(model);
      return Response.json(model === "p1/first" ? first : second);
    },
    log, comboName: "native-responses-text-config", comboStrategy: "fallback",
  });
  return { attempted, response, body: await response.json() };
}

describe("combo native Responses text configuration", () => {
  it("keeps a native image result that arrives with a text configuration", async () => {
    const first = {
      object: "response",
      id: "resp_image",
      status: "completed",
      output: [IMAGE_CALL],
      text: TEXT_CONFIG,
    };
    const result = await run(first);
    expect(result.attempted).toEqual(["p1/first"]);
    expect(result.body).toEqual(first);
  });

  it("keeps the same native image result without a text configuration", async () => {
    const first = {
      object: "response",
      id: "resp_image",
      status: "completed",
      output: [IMAGE_CALL],
    };
    const result = await run(first);
    expect(result.attempted).toEqual(["p1/first"]);
    expect(result.body).toEqual(first);
  });

  it("keeps a native text message that arrives with a text configuration", async () => {
    const first = {
      object: "response",
      id: "resp_message",
      status: "completed",
      output: [{ type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "answer" }] }],
      text: TEXT_CONFIG,
    };
    const result = await run(first);
    expect(result.attempted).toEqual(["p1/first"]);
    expect(result.body).toEqual(first);
  });

  it("still falls over for a genuinely empty native response that carries a text configuration", async () => {
    const result = await run({
      object: "response",
      id: "resp_empty",
      status: "completed",
      output: [],
      text: TEXT_CONFIG,
    });
    expect(result.attempted).toEqual(["p1/first", "p1/first", "p2/second"]);
    expect(result.body).toEqual({ text: "fallback" });
  });

  it("still falls over for an invalid image receipt that carries a text configuration", async () => {
    const result = await run({
      object: "response",
      id: "resp_empty_image",
      status: "completed",
      output: [{ type: "image_generation_call", id: "img_1", result: "" }],
      text: TEXT_CONFIG,
    });
    expect(result.attempted).toEqual(["p1/first", "p1/first", "p2/second"]);
    expect(result.body).toEqual({ text: "fallback" });
  });

  it.each(["queued", "in_progress"])("keeps a %s receipt that carries a text configuration", async (status) => {
    const first = {
      object: "response",
      id: `resp_${status}`,
      status,
      output: [],
      text: TEXT_CONFIG,
    };
    const result = await run(first);
    expect(result.attempted).toEqual(["p1/first"]);
    expect(result.body).toEqual(first);
  });

  it("keeps a queued receipt without a text configuration", async () => {
    const first = { object: "response", id: "resp_queued", status: "queued", output: [] };
    const result = await run(first);
    expect(result.attempted).toEqual(["p1/first"]);
    expect(result.body).toEqual(first);
  });

  it("keeps the existing empty chat payload fallback semantics", async () => {
    const result = await run({ choices: [{ message: { content: "" }, finish_reason: "stop" }] });
    expect(result.attempted).toEqual(["p1/first", "p1/first", "p2/second"]);
    expect(result.body).toEqual({ text: "fallback" });
  });

  it("keeps a plain text configuration object outside a native envelope empty", async () => {
    const result = await run({ text: TEXT_CONFIG });
    expect(result.attempted).toEqual(["p1/first", "p1/first", "p2/second"]);
    expect(result.body).toEqual({ text: "fallback" });
  });
});
