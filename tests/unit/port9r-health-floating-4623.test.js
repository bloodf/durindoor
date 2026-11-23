import { describe, expect, it } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

describe("combo lock ordering", () => {
  it("applies live lock ordering after the weighted strategy chooses a model", async () => {
    const calls = [];
    const response = await handleComboChat({
      body: { messages: [] },
      models: ["a/model", "b/model"],
      comboStrategy: "weighted",
      comboName: "lock-test",
      comboMembers: [{ model: "a/model", weight: 1 }, { model: "b/model", weight: 0 }],
      lockRanker: async (ordered) => [...ordered.filter((model) => model !== "a/model"), ...ordered.filter((model) => model === "a/model")],
      handleSingleModel: async (_body, model) => { calls.push(model); return Response.json({ choices: [{ message: { content: "ok" } }] }); },
      log: { info() {}, warn() {}, error() {} },
    });
    expect(response.ok).toBe(true);
    expect(calls).toEqual(["b/model"]);
  });
});
