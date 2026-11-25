import { describe, expect, it, vi } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

const DEPRECATED = "Claude Opus 4.5 is no longer available. Please switch to Claude Opus 4.6.";
const OUTDATED = "This version of Antigravity is no longer supported. Please download and install the latest version.";
const MODELS = ["antigravity/claude-opus-4-5", "openai/gpt-5.4"];

const json = (text) => Response.json({ choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }] });
const frame = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
const sse = (...frames) => new Response(frames.join(""), { headers: { "content-type": "text/event-stream" } });
const openaiStream = (...parts) => sse(...parts.map((content) => frame({ choices: [{ delta: { content } }] })), "data: [DONE]\n\n");
const claudeStream = (...parts) => sse(...parts.map((text) => frame({ type: "content_block_delta", delta: { type: "text_delta", text } })));

function run(first, { stream = false, second = json("sibling answer") } = {}) {
  const handleSingleModel = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  return handleComboChat({
    body: { messages: [{ role: "user", content: "hi" }], stream },
    models: MODELS,
    handleSingleModel,
    log: { info: vi.fn(), warn: vi.fn() },
    comboName: "notice",
    comboStrategy: "fallback",
  }).then((response) => ({ response, calls: handleSingleModel.mock.calls.length }));
}

describe("OmniRoute #21066 (8f599effad97) HTTP 200 model-unavailable notice fails over", () => {
  it.each([DEPRECATED, OUTDATED])("fails over a non-stream notice: %s", async (text) => {
    const { response, calls } = await run(json(text));
    expect(calls).toBe(2);
    expect(await response.text()).toContain("sibling answer");
  });

  it.each([
    ["OpenAI deltas", openaiStream("This version of Anti", "gravity is no longer ", "supported. Please update.")],
    ["Claude deltas", claudeStream("Claude Opus 4.5 is no ", "longer available. Please switch to Claude Opus 4.6.")],
  ])("fails over a notice split across %s", async (_label, first) => {
    const { response, calls } = await run(first, { stream: true, second: openaiStream("sibling answer") });
    expect(calls).toBe(2);
    expect(await response.text()).toContain("sibling answer");
  });

  it.each([
    "This version of Python is no longer supported, so upgrade to 3.12.",
    "This model is trained on public data.",
    "This version of Anti",
  ])("replays an ordinary streamed answer unchanged: %s", async (text) => {
    const first = openaiStream(text.slice(0, 6), text.slice(6));
    const expected = await first.clone().text();
    const { response, calls } = await run(first, { stream: true });
    expect(calls).toBe(1);
    expect(await response.text()).toBe(expected);
  });

  it.each([false, true])("keeps a long answer that quotes a notice after the prefix (stream: %s)", async (stream) => {
    const text = `${"Background. ".repeat(60)}${DEPRECATED}`;
    const { calls } = await run(stream ? openaiStream(text) : json(text), { stream });
    expect(calls).toBe(1);
  });

  it("surfaces 410 when every member returns the notice", async () => {
    const { response } = await run(json(DEPRECATED), { second: json(OUTDATED) });
    expect(response.status).toBe(410);
    expect((await response.json()).error.message).toContain("no longer supported");
  });
});
