import { describe, expect, it, vi } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

/**
 * Reachability through the real combo handler (9router b82f5c4 / #1364):
 * a 400 credit-exhaustion body must advance to the next model; an ordinary
 * 400 bad request must stop on the first member.
 */
describe("combo credit fallback", () => {
  it.each([
    ["You have insufficient credits to make this request.", true],
    ["Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.", true],
    ["Bad request", false],
  ])("routes a 400 response correctly: %s", async (message, shouldContinue) => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    const models = ["cmc/deepseek/deepseek-v4-pro", "mistral/mistral-medium-latest"];
    const failure = Response.json({ error: { message } }, { status: 400 });
    const success = Response.json({ choices: [{ message: { content: "Hello" } }] });
    const handleSingleModel = vi.fn()
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(success);

    const response = await handleComboChat({
      body, models, handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() },
      comboName: "credit-fallback", comboStrategy: "fallback",
    });

    expect(response).toBe(shouldContinue ? success : failure);
    // DurinDoor's handleComboChat passes (body, model, signal); signal is null
    // when no per-member timeout AbortSignal is installed for the attempt.
    expect(handleSingleModel.mock.calls).toEqual(
      (shouldContinue ? models : models.slice(0, 1)).map((model) => [body, model, null])
    );
  });
});
