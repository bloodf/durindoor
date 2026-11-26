import { describe, expect, it, vi } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

// The billing notice observed on the wire from Pollinations.
const NOTICE = "The account behind this API key doesn't have enough credits. Please top up or complete a quest, then try again.";
const MODELS = ["pol/openai", "openai/gpt-5.4"];

const frame = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
const delta = (content, extra = {}) => frame({ choices: [{ delta: { content } }], ...extra });
const DONE = "data: [DONE]\n\n";
const split = (text) => [text.slice(0, 20), text.slice(20, 55), text.slice(55)];

/** One network read per frame, as DurinDoor's stream transform enqueues them. */
function sse(...frames) {
  const encoder = new TextEncoder();
  const queue = [...frames];
  return new Response(new ReadableStream({
    pull(controller) {
      if (queue.length) controller.enqueue(encoder.encode(queue.shift()));else
      controller.close();
    }
  }), { headers: { "content-type": "text/event-stream" } });
}
const answer = (...parts) => sse(...parts.map((part) => delta(part)), DONE);

async function run(first, { models = MODELS, second = answer("sibling answer") } = {}) {
  const handleSingleModel = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const response = await handleComboChat({
    body: { messages: [{ role: "user", content: "hi" }], stream: true },
    models,
    handleSingleModel,
    log: { info: vi.fn(), warn: vi.fn() },
    comboName: "billing",
    comboStrategy: "fallback",
  });
  return { response, calls: handleSingleModel.mock.calls.length };
}

async function expectReplayed(frames, options) {
  const { response, calls } = await run(sse(...frames), options);
  expect(calls).toBe(1);
  expect(await response.text()).toBe(frames.join(""));
}

describe("OmniRoute #20530 streamed billing notice fails over", () => {
  it("fails over a short notice split across SSE deltas", async () => {
    const { response, calls } = await run(answer(...split(NOTICE)));
    expect(calls).toBe(2);
    expect(await response.text()).toContain("sibling answer");
  });

  it.each(["pollinations/openai", "pw/pplx-auto", "perplexity-web/pplx-auto"])("resolves the member's provider from %s", async (member) => {
    const { calls } = await run(answer(NOTICE), { models: [member, "openai/gpt-5.4"] });
    expect(calls).toBe(2);
  });

  it("fails over a notice sent as Claude text deltas", async () => {
    const frames = split(NOTICE).map((text) => frame({ type: "content_block_delta", delta: { type: "text_delta", text } }));
    const { calls } = await run(sse(...frames));
    expect(calls).toBe(2);
  });

  it("ignores the gateway's estimated usage when judging the notice", async () => {
    const finish = frame({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { completion_tokens: 27, estimated: true } });
    const { calls } = await run(sse(delta(NOTICE), finish, DONE));
    expect(calls).toBe(2);
  });

  it("surfaces 402 when every member returns the notice", async () => {
    const { response } = await run(answer(NOTICE), { models: ["pol/openai", "pollinations/mistral"], second: answer(NOTICE) });
    expect(response.status).toBe(402);
    expect((await response.json()).error.message).toContain("enough credits");
  });

  it("replays an ordinary short answer unchanged", async () => {
    await expectReplayed([delta("Paris is the "), delta("capital of France."), DONE]);
  });

  it("replays a long answer that mentions topping up", async () => {
    await expectReplayed([delta("Background. ".repeat(60)), delta(NOTICE), DONE]);
  });

  it("replays the text when the provider reports real completion usage", async () => {
    await expectReplayed([delta(NOTICE), frame({ choices: [], usage: { completion_tokens: 27 } }), DONE]);
  });

  it("replays the text when the turn also carries a tool call", async () => {
    await expectReplayed([delta(NOTICE), frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1" }] } }] }), DONE]);
  });

  it("leaves providers outside the fake-success allowlist untouched", async () => {
    await expectReplayed([delta(NOTICE), DONE], { models: ["openai/gpt-5.4", "pol/openai"] });
  });
});
