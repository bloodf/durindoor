import { describe, expect, it } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

const GUIDANCE = "The configured model is unavailable from the provider — it may have been renamed, retired, or is not offered on this account.";

function frame(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify({ type: event, ...payload })}\n\n`;
}

function peek(frames) {
  return new CodexExecutor()._peekSseTransientError(
    new Response(frames.join(""), { status: 200, headers: { "Content-Type": "text/event-stream" } })
  );
}

describe("decolua/9router#4373 - Codex unavailable-model failures reach fallback", () => {
  it("classifies the unavailable-model guidance as fallback-eligible on both paths", async () => {
    expect(checkFallbackError(400, GUIDANCE).shouldFallback).toBe(true);
    await expect(peek([frame("error", { error: { message: GUIDANCE } })])).resolves.toMatchObject({ modelRejected: true, message: GUIDANCE });
  });

  it.each(["response.output_text.delta", "response.function_call_arguments.delta"])(
    "keeps peeking past an empty %s to the failure behind it",
    async (event) => {
      const result = await peek([frame(event, { delta: "" }), frame("response.failed", { response: { error: { message: GUIDANCE } } })]);

      expect(result).toMatchObject({ modelRejected: true, replacementBody: null });
    }
  );

  it("still commits the stream once real tool arguments arrive", async () => {
    const frames = [frame("response.function_call_arguments.delta", { delta: "{" }), frame("response.failed", { response: { error: { message: GUIDANCE } } })];

    const first = await new CodexExecutor()._peekSseTransientError(new Response(new ReadableStream({
      start(controller) {
        for (const chunk of frames) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }), { status: 200 }));

    expect(first.matched).toBeNull();
    await expect(new Response(first.replacementBody).text()).resolves.toBe(frames.join(""));
  });
});
