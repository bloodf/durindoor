import { describe, expect, it } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

const log = { info() {}, warn() {}, error() {}, debug() {} };

const reply = (status, payload) =>
  new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

async function runCombo(responses, comboName) {
  const res = await handleComboChat({
    body: { messages: [] },
    models: responses.map((_, index) => `p${index}/m${index}`),
    handleSingleModel: async (_body, modelStr) => responses[Number(modelStr[1])](),
    log,
    comboName,
    comboStrategy: "priority",
  });
  return { status: res.status, message: (await res.json()).error.message };
}

describe("port decolua/9router#4823: combo fallback status stays paired with its message", () => {
  it("does not pair an earlier 429 status with a later HTTP 200 error message", async () => {
    const result = await runCombo(
      [
        () => reply(429, { error: { message: "first member rate limited" } }),
        () => reply(200, { error: { message: "upstream temporarily unavailable" } }),
      ],
      "combo-200-error-4823"
    );

    expect(result).toEqual({ status: 503, message: "upstream temporarily unavailable" });
  });

  it("keeps an authentication failure's message when a later HTTP 200 carries an error", async () => {
    const result = await runCombo(
      [
        () => reply(401, { error: { message: "bad credentials" } }),
        () => reply(200, { error: { message: "upstream temporarily unavailable" } }),
      ],
      "combo-auth-200-error-4823"
    );

    expect(result).toEqual({ status: 401, message: "bad credentials" });
  });
});
