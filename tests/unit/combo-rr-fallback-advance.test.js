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

describe("AgentRouter combo fallback classification", () => {
  it("falls through after an AgentRouter quota-shaped 400", async () => {
    const attempts = [];
    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["agentrouter/first", "openai/second"],
      comboName: "agentrouter-quota-400",
      comboStrategy: "fallback",
      autoSwitch: false,
      log,
      handleSingleModel: async (_body, model) => {
        attempts.push(model);
        if (model === "agentrouter/first") {
          return new Response(JSON.stringify({ error: { message: "用户额度不足" } }), { status: 400 });
        }
        return Response.json({ choices: [{ message: { content: "ok" } }] });
      },
    });

    expect(attempts).toEqual(["agentrouter/first", "openai/second"]);
    expect(result.ok).toBe(true);
  });
});
