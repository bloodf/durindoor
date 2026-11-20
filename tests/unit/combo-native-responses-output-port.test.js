import { describe, expect, it } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

const log = { info() {}, warn() {}, error() {}, debug() {} };

async function run(first) {
  const attempted = [];
  const response = await handleComboChat({
    body: { stream: false, messages: [{ role: "user", content: "hello" }] },
    models: ["p1/first", "p2/second"],
    handleSingleModel: async (_body, model) => {
      attempted.push(model);
      return Response.json(model === "p1/first" ? first : { text: "fallback" });
    },
    log, comboName: "native-responses", comboStrategy: "fallback",
  });
  return { attempted, body: await response.json() };
}

describe("combo native Responses output", () => {
  it.each([
    { object: "response", id: "resp_image", status: "completed", output: [{ type: "image_generation_call", id: "img_1", result: "c3ludGhldGlj" }] },
    { object: "response", id: "resp_queued", status: "queued", output: [] },
    { object: "response", id: "resp_running", status: "in_progress", output: [] },
  ])("returns valid native output unchanged %#", async (first) => {
    const result = await run(first);
    expect(result.attempted).toEqual(["p1/first"]);
    expect(result.body).toEqual(first);
  });

  it.each([
    { object: "response", id: "resp_empty", status: "completed", output: [] },
    { object: "response", id: " ", status: "queued", output: [] },
    { object: "response", id: "resp_empty_image", status: "completed", output: [{ type: "image_generation_call", result: "" }] },
  ])("falls over for empty output or an invalid receipt %#", async (first) => {
    const result = await run(first);
    expect(result.attempted).toEqual(["p1/first", "p1/first", "p2/second"]);
    expect(result.body).toEqual({ text: "fallback" });
  });
});
