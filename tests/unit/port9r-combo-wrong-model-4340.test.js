// Port of upstream 9router #4340: a model-scoped 4xx from one combo member
// advances to the next member. Account rotation keeps treating a wrong model as
// terminal (#750).
import { beforeEach, describe, expect, it } from "vitest";
import { handleComboChat, resetComboRotation } from "../../open-sse/services/combo.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

const log = { info() {}, warn() {}, error() {}, debug() {} };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ok = () => json(200, { choices: [{ index: 0, message: { role: "assistant", content: "served" }, finish_reason: "stop" }] });

async function runCombo(first, second = ok) {
  const attempted = [];
  const response = await handleComboChat({
    body: { model: "combo", stream: false, messages: [{ role: "user", content: "hi" }] },
    models: ["codex/model-x", "openai/model-y"],
    handleSingleModel: async (_body, model) => {
      attempted.push(model);
      return attempted.length === 1 ? first() : second();
    },
    log,
    comboName: "wrong-model-4340",
    comboStrategy: "fallback",
  });
  return { attempted, response };
}

beforeEach(() => resetComboRotation());

describe("upstream 9router #4340: combo advances past a wrong-model rejection", () => {
  it.each([
    [400, "The 'model-x' model is not supported when using Codex with a ChatGPT account."],
    [400, "Model model-x is not supported"],
    [400, "unknown model"],
    [404, "The model does not exist"],
    [410, "unknown model"],
  ])("serves from the next member after %s %s", async (status, message) => {
    const { attempted, response } = await runCombo(() => json(status, { error: { message } }));

    expect(attempted).toEqual(["codex/model-x", "openai/model-y"]);
    expect(response.status).toBe(200);
  });

  it("returns the first member's own response when every member rejects the model", async () => {
    const { attempted, response } = await runCombo(
      () => json(404, { error: { message: "model not found: first" } }),
      () => json(400, { error: { message: "unknown model: second" } }),
    );

    expect(attempted).toHaveLength(2);
    expect(response.status).toBe(404);
    expect((await response.json()).error.message).toBe("model not found: first");
  });

  it.each([
    [401, "ModelError: model not found"],
    [403, "model gpt-x is not allowed for this key"],
  ])("still stops on %s %s", async (status, message) => {
    const { attempted, response } = await runCombo(() => json(status, { error: { message } }));

    expect(attempted).toEqual(["codex/model-x"]);
    expect(response.status).toBe(status);
  });

  it("keeps the account-rotation verdict terminal", () => {
    expect(checkFallbackError(401, "model not found")).toEqual({ shouldFallback: false, cooldownMs: 0, scope: null });
  });
});
