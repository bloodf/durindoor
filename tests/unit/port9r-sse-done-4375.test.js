// decolua/9router#4375: a translated stream whose client format is OpenAI chat
// must end with exactly one `data: [DONE]` even if the upstream never sent one
// (Gemini streams end with the connection closing, not a sentinel).
import { describe, expect, it } from "vitest";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import "../translator/registerAll.js";

async function run(chunks, source, target, provider, model) {
  const encoder = new TextEncoder();
  const input = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  const reader = input.pipeThrough(createSSETransformStreamWithLogger(target, source, provider, null, null, model)).getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

describe("translated OpenAI stream terminator (#4375)", () => {
  it("terminates a Gemini->OpenAI stream with exactly one data: [DONE]", async () => {
    const text = await run(
      [`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "hi" }] } }] })}\n`],
      FORMATS.OPENAI, FORMATS.GEMINI, "gemini", "gemini-3.8-flash",
    );
    expect(text.match(/data: \[DONE\]/g)).toHaveLength(1);
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true);
  });

  it("does not duplicate [DONE] when the upstream already sent one", async () => {
    const text = await run(
      [`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "hi" }] } }] })}\n`, "data: [DONE]\n\n"],
      FORMATS.OPENAI, FORMATS.GEMINI, "gemini", "gemini-3.8-flash",
    );
    expect(text.match(/data: \[DONE\]/g)).toHaveLength(1);
  });
});
