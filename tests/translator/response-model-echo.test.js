// Claude stream response should echo client-requested model, not provider chunk.model.
// Unseeded translation state falls back to provider model, then MODEL_FALLBACK.
import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { MODEL_FALLBACK } from "../../open-sse/translator/schema/index.js";
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

function firstChunk(model = "glm-5.3") {
  return {
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    ...(model === null ? {} : { model }),
    choices: [{ delta: { content: "hi" } }],
  };
}

function findMessageStart(events) {
  return events.find((e) => e?.type === "message_start");
}

describe("Claude response model echo", () => {
  it("preserves a seeded client-requested model over the provider chunk's model", () => {
    const state = { ...initState(FORMATS.OPENAI), model: "claude-opus-5" };
    const events = translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, firstChunk(), state);
    const start = findMessageStart(events);
    expect(start?.message?.model).toBe("claude-opus-5");
  });

  it("falls back to the provider chunk's model when state.model is unset", () => {
    const state = initState(FORMATS.OPENAI);
    const events = translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, firstChunk(), state);
    const start = findMessageStart(events);
    expect(start?.message?.model).toBe("glm-5.3");
  });

  it("uses MODEL_FALLBACK when unseeded state and provider chunk both omit model", () => {
    const state = initState(FORMATS.OPENAI);
    const events = translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, firstChunk(null), state);
    const start = findMessageStart(events);

    expect(start?.message?.model).toBe(MODEL_FALLBACK);
  });
});
