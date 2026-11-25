import { describe, expect, it, vi } from "vitest";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { handleComboChat } from "../../open-sse/services/combo.js";
import { errorResponse } from "../../open-sse/utils/error.js";

const REJECTION = "The 'gpt-5.6-sol' model is not supported when using Codex with a ChatGPT account.";
const log = { info() {}, warn() {}, debug() {}, error() {} };

function sseResponse(text) {
  return new Response(text, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function runCombo(status, message) {
  const attempted = [];
  const result = await handleComboChat({
    body: { messages: [{ role: "user", content: "hi" }] },
    models: ["cx/gpt-5.6-sol", "openai/gpt-5"],
    handleSingleModel: async (_body, model) => {
      attempted.push(model);
      return attempted.length === 1 ?
        errorResponse(status, message) :
        new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { headers: { "Content-Type": "application/json" } });
    },
    log,
  });
  return { attempted, result };
}

describe("decolua/9router#4381 - Codex model-scoped refusals fall through", () => {
  it("locks the account for this model instead of treating the ChatGPT refusal as a wrong model", () => {
    const decision = checkFallbackError({ status: 400, errorText: REJECTION });

    expect(decision.shouldFallback).toBe(true);
    expect(decision.cooldownMs).toBeGreaterThan(0);
  });

  it("keeps an ordinary wrong-model 400 terminal", () => {
    expect(checkFallbackError(400, "The model gpt-nope is not supported").shouldFallback).toBe(false);
  });

  it.each([
    [400, REJECTION],
    [410, "The model 'gpt-5.6-sol' has reached its end of life."],
  ])("advances the combo past a %i refusal", async (status, message) => {
    const { attempted, result } = await runCombo(status, message);

    expect(attempted).toEqual(["cx/gpt-5.6-sol", "openai/gpt-5"]);
    expect(result.ok).toBe(true);
  });

  it("turns a 200 SSE response.failed refusal into the same 400 as the HTTP path", async () => {
    const executor = new CodexExecutor();
    const peek = await executor._peekSseTransientError(sseResponse([
      "event: response.failed",
      `data: ${JSON.stringify({ type: "response.failed", response: { status: "failed", error: { message: REJECTION } } })}`,
      "",
      "",
    ].join("\n")));

    expect(peek).toMatchObject({ modelRejected: true, accountFallback: false, message: REJECTION, replacementBody: null });
  });

  it("returns that 400 from execute without retrying the same account", async () => {
    const dispatch = vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({
      response: sseResponse(`event: response.failed\ndata: ${JSON.stringify({ response: { error: { message: REJECTION } } })}\n\n`),
    });
    try {
      const { response } = await new CodexExecutor().execute({ body: { input: [] }, credentials: { providerSpecificData: {} }, log: {} });

      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(400);
      expect((await response.json()).error.message).toBe(REJECTION);
    } finally {
      dispatch.mockRestore();
    }
  });

  it("does not classify answer text that quotes the refusal", async () => {
    const executor = new CodexExecutor();
    const peek = await executor._peekSseTransientError(sseResponse(
      `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: REJECTION })}\n\n`
    ));

    expect(peek.matched).toBeNull();
  });
});
