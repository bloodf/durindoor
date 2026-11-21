import { describe, expect, it } from "vitest";
import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

const image = "data:image/png;base64,iVBORw0KGgo=";
const legacy = { type: "image_url", image_url: { url: image, detail: "high" } };
const inputImage = { type: "input_image", image_url: image, detail: "high" };
const outputImage = { type: "output_text", text: `[Image: ${image}]` };

describe("Responses image history roles", () => {
  it("translates Chat roles while preserving tool pairing and order", () => {
    const result = openaiToOpenAIResponsesRequest("model", { messages: [
      { role: "user", content: [legacy] },
      { role: "assistant", content: [{ type: "text", text: "seen" }, legacy, { type: "input_image", image_url: image }], tool_calls: [{ id: "call_1", type: "function", function: { name: "inspect", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_1", content: [{ type: "text", text: "done" }, legacy] },
    ] }, true, null);
    expect(result.input[0].content).toEqual([inputImage]);
    expect(result.input[1].content).toEqual([{ type: "output_text", text: "seen" }, outputImage, outputImage]);
    expect(result.input[2]).toMatchObject({ type: "function_call", call_id: "call_1" });
    expect(result.input[3]).toMatchObject({ type: "function_call_output", call_id: "call_1", output: [{ type: "input_text", text: "done" }, inputImage] });
  });

  it("normalizes native replay without rewriting unrelated output arrays or file references", async () => {
    const executor = new CodexExecutor();
    const file = { type: "input_image", file_id: "file_1" };
    const other = { type: "other", output: [legacy] };
    const body = { input: [
      { type: "message", role: "user", content: [legacy, file] },
      { type: "message", role: "assistant", content: [legacy, { type: "input_image", image_url: image }, { type: "refusal", refusal: "no" }] },
      { type: "function_call", call_id: "call_1", name: "inspect", arguments: "{}" },
      { type: "function_call_output", call_id: "call_1", output: [{ type: "input_text", text: "done" }, legacy, file] }, other,
    ] };
    await executor.prefetchImages(body);
    const result = executor.transformRequest("model", body, true, {});
    expect(result.input[0].content).toEqual([inputImage, file]);
    expect(result.input[1].content).toEqual([outputImage, outputImage, { type: "refusal", refusal: "no" }]);
    expect(result.input[2]).toMatchObject({ type: "function_call", call_id: "call_1" });
    expect(result.input[3]).toMatchObject({ type: "function_call_output", call_id: "call_1", output: [{ type: "input_text", text: "done" }, inputImage, file] });
    expect(result.input[4]).toEqual(other);
  });
});
