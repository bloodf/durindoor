import { beforeEach, describe, expect, it } from "vitest";
import { getComboModelQuotaHealth, handleComboChat, resetComboScoring } from "../../open-sse/services/combo.js";

const log = { info() {}, warn() {}, error() {}, debug() {} };
const encoder = new TextEncoder();
const sse = (text) => new Response(new ReadableStream({
  start(controller) { controller.enqueue(encoder.encode(text)); controller.close(); },
}), { headers: { "content-type": "text/event-stream" } });
const frame = (error) => `data: ${JSON.stringify({ error })}\n\ndata: [DONE]\n\n`;
const content = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n';
const refusal = frame({ type: "invalid_request_error", message: "Invalid input api_key=sk-secret12345678901234567890" });

async function run(first, second, comboName = "precontent-2068") {
  const attempted = [];
  const response = await handleComboChat({
    body: { stream: true, messages: [{ role: "user", content: "hi" }] },
    models: ["p1/first", "p2/second"], comboName, comboStrategy: "smart-scoring", log,
    handleSingleModel: async (_body, model) => { attempted.push(model); return sse(model === "p1/first" ? first : second); },
  });
  return { response, attempted };
}
beforeEach(() => resetComboScoring("precontent-2068"));

describe("combo pre-content errors (#2068)", () => {
  it("retains a sanitized request refusal when later members are empty", async () => {
    const { response, attempted } = await run(refusal, ": ping\n\n");
    expect(attempted).toEqual(["p1/first", "p2/second"]);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toContain("Invalid input");
    expect(body.error.message).not.toContain("sk-secret12345678901234567890");
    expect(getComboModelQuotaHealth("precontent-2068", "p1/first")).toBe("healthy");
  });
  it("still serves a later successful member after a refusal", async () => {
    const { response, attempted } = await run(refusal, content);
    expect(attempted).toEqual(["p1/first", "p2/second"]);
    expect(await response.text()).toBe(content);
  });
  it("falls back and degrades health for a retryable error", async () => {
    const { response, attempted } = await run(frame({ type: "server_error", message: "temporary" }), content);
    expect(attempted).toEqual(["p1/first", "p2/second"]);
    expect(await response.text()).toBe(content);
    expect(getComboModelQuotaHealth("precontent-2068", "p1/first")).toBe("degraded");
  });
  it("replays normal content without falling back", async () => {
    const { response, attempted } = await run(content, "");
    expect(attempted).toEqual(["p1/first"]);
    expect(await response.text()).toBe(content);
  });
  it("replays native Responses output and its terminal event", async () => {
    const native = 'data: {"type":"response.output_text.delta","delta":"hello"}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\ndata: [DONE]\n\n';
    const { response, attempted } = await run(native, "");
    expect(attempted).toEqual(["p1/first"]);
    expect(await response.text()).toBe(native);
  });
  it("keeps genuine empty streams as 503", async () => {
    const { response, attempted } = await run(": ping\n\n", "data: [DONE]\n\n");
    expect(attempted).toEqual(["p1/first", "p2/second"]);
    expect(response.status).toBe(503);
  });
});
