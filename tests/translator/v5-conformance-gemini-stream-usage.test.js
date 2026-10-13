import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { OPENAI_FINISH, ROLE } from "../../open-sse/translator/schema/index.js";

// Issue #1089 row N5 (UNCERTAIN edge). Static trace: the stream adapter copies completion_tokens
// into candidatesTokenCount, while the JSON handler subtracts reasoning tokens. Neither side has
// been run; these are ordinary assertions so an independent verifier can reproduce RED or GREEN.
// Which count clients expect is not established; Gemini's own total is prompt + candidates + thoughts.
const usage = {
  prompt_tokens: 10, completion_tokens: 5, total_tokens: 15,
  completion_tokens_details: { reasoning_tokens: 2 },
};
const streamUsage = () => {
  const state = initState(FORMATS.GEMINI);
  const out = translateResponse(FORMATS.OPENAI, FORMATS.GEMINI, {
    id: "chat-stream", model: "m",
    choices: [{ index: 0, delta: { content: "answer" }, finish_reason: OPENAI_FINISH.STOP }],
    usage,
  }, state);
  return out[0].response.usageMetadata;
};
const jsonUsage = () => translateNonStreamingResponse({
  id: "chat-json", model: "m", object: "chat.completion",
  choices: [{ index: 0, message: { role: ROLE.ASSISTANT, content: "answer" }, finish_reason: OPENAI_FINISH.STOP }],
  usage,
}, FORMATS.OPENAI, FORMATS.GEMINI).usageMetadata;

describe("#1089 Gemini client usage parity between stream and JSON", () => {
  it("reports the same reasoning count on both paths", () => {
    expect(streamUsage().thoughtsTokenCount).toBe(2);
    expect(jsonUsage().thoughtsTokenCount).toBe(2);
  });
  it("reports the same candidatesTokenCount on both paths", () => {
    expect(streamUsage().candidatesTokenCount).toBe(jsonUsage().candidatesTokenCount);
  });
  it("keeps prompt + candidates + thoughts equal to total on the stream path", () => {
    const u = streamUsage();
    expect(u.promptTokenCount + u.candidatesTokenCount + u.thoughtsTokenCount).toBe(u.totalTokenCount);
  });
});
