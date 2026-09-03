import { describe, expect, it } from "vitest";
import { handleComboChat, getRotatedModels, resetComboRotation } from "../../open-sse/services/combo.js";

const log = {
  info() {},
  warn() {},
  debug() {},
  error() {},
};

// Unique per-request message content prevents getRotatedModels' conversation-affinity
// pinning from short-circuiting rotation, so the sticky counter under test actually runs.
async function servedConnection(comboName, stickyLimit, message = "hi") {
  let served = "";
  await handleComboChat({
    body: { messages: [{ role: "user", content: message }] },
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

  it("counts fallback winner's successful request toward sticky round-robin limit", async () => {
    const stickyThreeComboName = `rr-fallback-sticky-three-${Date.now()}`;
    resetComboRotation(stickyThreeComboName);

    const stickyThreeWinners = [];
    for (let request = 0; request < 4; request++) {
      stickyThreeWinners.push(await servedConnection(stickyThreeComboName, 3, `sticky-three-${request}`));
    }

    const stickyOneComboName = `rr-fallback-sticky-one-${Date.now()}`;
    resetComboRotation(stickyOneComboName);

    const stickyOneWinners = [];
    for (let request = 0; request < 2; request++) {
      stickyOneWinners.push(await servedConnection(stickyOneComboName, 1, `sticky-one-${request}`));
    }

    expect(stickyThreeWinners).toEqual(["provider/b", "provider/b", "provider/b", "provider/c"]);
    expect(stickyOneWinners).toEqual(["provider/b", "provider/c"]);
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
