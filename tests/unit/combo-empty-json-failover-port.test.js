import { describe, expect, it } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

const log = { info() {}, warn() {}, error() {}, debug() {} };

async function run(first, second = { text: "fallback" }) {
  const attempted = [];
  const response = await handleComboChat({
    body: { stream: false, messages: [{ role: "user", content: "hello" }] },
    models: ["p1/first", "p2/second"],
    handleSingleModel: async (_body, model) => {
      attempted.push(model);
      return Response.json(model === "p1/first" ? first : second);
    },
    log, comboName: "empty-json-port", comboStrategy: "fallback",
  });
  return { attempted, response, body: await response.json() };
}

describe("combo empty JSON failover (#5646)", () => {
  it.each([
    { text: "  " }, {}, { choices: [{ message: { content: "" }, finish_reason: "stop" }] },
    { content: [{ type: "text", text: " " }] },
    { candidates: [{ content: { parts: [{ text: "" }] }, finishReason: "STOP" }] },
    { output: [{ type: "message", content: [{ type: "output_text", text: "" }] }] },
  ])("retries and falls through for empty output %#", async (first) => {
    const result = await run(first);
    expect(result.attempted).toEqual(["p1/first", "p1/first", "p2/second"]);
    expect(result.body).toEqual({ text: "fallback" });
  });

  it.each([
    { choices: [{ message: { content: "answer" } }] },
    { choices: [{ message: { tool_calls: [{ id: "call" }] } }] },
    { choices: [{ message: { content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA" } }] } }] },
    { content: [{ type: "thinking", thinking: "reason" }] },
    { candidates: [{ content: { parts: [{ inlineData: { data: "AA" } }] } }] },
    { output: [{ type: "function_call", name: "tool" }] },
    { choices: [{ message: { content: "" }, finish_reason: "content_filter" }] },
    { candidates: [{ finishReason: "SAFETY" }] },
    { stop_reason: "refusal", content: [] },
    { provider_specific: true },
  ])("preserves usable or legitimate output %#", async (first) => {
    const result = await run(first);
    expect(result.attempted).toEqual(["p1/first"]);
    expect(result.body).toEqual(first);
  });

  it("returns a gateway error when both members remain empty", async () => {
    const result = await run({ text: "" }, { output: [] });
    expect(result.attempted).toEqual(["p1/first", "p1/first", "p2/second", "p2/second"]);
    expect(result.response.status).toBe(502);
    expect(result.body.error.message).toContain("empty content");
  });
});
