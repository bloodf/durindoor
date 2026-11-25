import { describe, expect, it, vi } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

const notice = "Claude Opus 4.5 is no longer available. Please switch to Claude Opus 4.6.";
const json = (text) => Response.json({ choices: [{ message: { role: "assistant", content: text } }] });
const stream = (...parts) => new Response(parts.map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });

async function run(first, streaming) {
  const handleSingleModel = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(streaming ? stream("fallback") : json("fallback"));
  const response = await handleComboChat({
    body: { messages: [{ role: "user", content: "hi" }], stream: streaming },
    models: ["antigravity/claude-opus-4-5", "openai/gpt-5.4"],
    handleSingleModel,
    log: { info: vi.fn(), warn: vi.fn() },
    comboName: "notice-review",
    comboStrategy: "fallback",
  });
  return { calls: handleSingleModel.mock.calls.length, text: await response.text() };
}

describe("unavailable notices must be the whole answer", () => {
  it.each([false, true])("keeps an answer quoting a notice (stream: %s)", async (streaming) => {
    const answer = `The provider reported: ${notice} You can choose another model.`;
    const { calls, text } = await run(streaming ? stream("The provider reported: ", notice, " You can choose another model.") : json(answer), streaming);
    expect(calls).toBe(1);
    expect(text).toContain("The provider reported:");
  });

  it.each([false, true])("keeps an answer that starts with a notice and continues (stream: %s)", async (streaming) => {
    const { calls, text } = await run(streaming ? stream(notice, " Here is what that means.") : json(`${notice} Here is what that means.`), streaming);
    expect(calls).toBe(1);
    expect(text).toContain("Here is what that means.");
  });

  it.each([false, true])("fails over a bare notice (stream: %s)", async (streaming) => {
    const { calls, text } = await run(streaming ? stream(notice.slice(0, 25), notice.slice(25)) : json(notice), streaming);
    expect(calls).toBe(2);
    expect(text).toContain("fallback");
  });
});
