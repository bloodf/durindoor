import { describe, expect, it } from "vitest";
import { handleComboChat, getRotatedModels, resetComboRotation } from "../../open-sse/services/combo.js";

const log = {
  info() {},
  warn() {},
  debug() {},
  error() {},
};

async function servedConnection(comboName, stickyLimit) {
  let served = "";
  await handleComboChat({
    body: { messages: [{ role: "user", content: "hi" }] },
    models: ["provider/a", "provider/b", "provider/c"],
    comboName,
    comboStrategy: "round-robin",
    comboStickyLimit: stickyLimit,
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

    const first = await servedConnection(comboName, 1);
    const second = await servedConnection(comboName, 1);

    expect(first).toBe("provider/b");
    expect(second).toBe("provider/c");
  });

  it("pins served model as the sticky base for sticky round-robin after fallback", async () => {
    const comboName = `rr-fallback-sticky-${Date.now()}`;
    resetComboRotation(comboName);

    const first = await servedConnection(comboName, 3);
    const second = await servedConnection(comboName, 3);

    expect(first).toBe("provider/b");
    expect(second).toBe("provider/b");
  });
});
