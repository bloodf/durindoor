import { describe, expect, it } from "vitest";
import { handleComboChat, resetComboRotation } from "../../open-sse/services/combo.js";

const log = {
  info() {},
  warn() {},
  debug() {},
  error() {},
};

async function servedConnection(comboName) {
  let served = "";
  await handleComboChat({
    body: { messages: [{ role: "user", content: "hi" }] },
    models: ["provider/a", "provider/b", "provider/c"],
    comboName,
    comboStrategy: "round-robin",
    comboStickyLimit: 1,
    autoSwitch: false,
    log,
    handleSingleModel: async (_body, model) => {
      if (model === "provider/a") {
        return new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429 });
      }
      served = model;
      return Response.json({ choices: [{ message: { role: "assistant", content: model } }] });
    },
  });
  return served;
}

describe("combo round-robin fallback pointer", () => {
  it("advances past the model that actually served after scheduled model fallback", async () => {
    const comboName = `rr-fallback-${Date.now()}`;
    resetComboRotation(comboName);

    const first = await servedConnection(comboName);
    const second = await servedConnection(comboName);

    expect(first).toBe("provider/b");
    expect(second).toBe("provider/c");
  });
});
