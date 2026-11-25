/**
 * Upstream 9router #4518: a Responses `function_call_output` may carry
 * `input_image` parts (Codex `view_image`, screenshots). The worker converter
 * (`open-sse/translator/formats/responsesApi.js`) used to serialize the whole
 * output array into the tool message, so the picture only ever reached the
 * provider as text.
 *
 * The port keeps this converter's tool-output serialization contract — the tool
 * message still carries the JSON encoding of the output — and additionally
 * lifts the image parts into a following user turn as real `image_url` blocks,
 * so the model receives the picture itself.
 *
 * The scoped-file-ID contract is unchanged: `image_url` still wins over
 * `file_id`, and a file ID with no URL is rejected with HTTP 400 before the
 * request is dispatched.
 */
import { describe, expect, it } from "vitest";
import { convertResponsesApiFormat } from "../../open-sse/translator/formats/responsesApi.js";

const IMAGE = "data:image/png;base64,iVBORw0KGgo=";
const REMOTE_IMAGE = "https://example.com/reference.png";

const imagePart = (overrides = {}) => ({ type: "input_image", image_url: IMAGE, detail: "high", ...overrides });
const textPart = (text) => ({ type: "input_text", text });

function convert(input) {
  return convertResponsesApiFormat({ input });
}

describe("Responses tool output with image parts", () => {
  it("lifts the image into a following user turn with a real image block", () => {
    const output = [imagePart()];
    const converted = convert([
      { type: "function_call", call_id: "c1", name: "view_image", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output },
    ]);

    expect(converted.messages.map((message) => message.role)).toEqual(["assistant", "tool", "user"]);

    // The tool message keeps this converter's serialization contract.
    const tool = converted.messages.find((message) => message.role === "tool");
    expect(tool.tool_call_id).toBe("c1");
    expect(tool.content).toBe(JSON.stringify(output));

    // The image itself now travels as an image block, not only as text.
    expect(converted.messages.at(-1).content).toEqual([
      { type: "image_url", image_url: { url: IMAGE, detail: "high" } },
    ]);
  });

  it("keeps tool messages contiguous and attaches the images after the run", () => {
    const converted = convert([
      { type: "function_call", call_id: "c1", name: "view_image", arguments: "{}" },
      { type: "function_call", call_id: "c2", name: "shell", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output: [imagePart()] },
      { type: "function_call_output", call_id: "c2", output: "ok" },
      { type: "message", role: "user", content: [{ type: "input_text", text: "next" }] },
    ]);

    expect(converted.messages.map((message) => message.role)).toEqual(["assistant", "tool", "tool", "user", "user"]);

    const tools = converted.messages.filter((message) => message.role === "tool");
    expect(tools.map((message) => message.tool_call_id)).toEqual(["c1", "c2"]);

    const imageTurn = converted.messages.at(-2);
    expect(imageTurn.content).toEqual([
      { type: "image_url", image_url: { url: IMAGE, detail: "high" } },
    ]);
    // The trailing user message keeps its own text.
    expect(converted.messages.at(-1).content).toEqual([{ type: "text", text: "next" }]);
  });

  it("collects every image of a mixed output into the same user turn", () => {
    const output = [textPart("captured"), imagePart(), imagePart({ image_url: REMOTE_IMAGE, detail: undefined })];
    const converted = convert([
      { type: "function_call", call_id: "c1", name: "view_image", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output },
    ]);

    expect(converted.messages.at(-1).content).toEqual([
      { type: "image_url", image_url: { url: IMAGE, detail: "high" } },
      { type: "image_url", image_url: { url: REMOTE_IMAGE, detail: "auto" } },
    ]);
  });

  it("adds no user turn when the tool output carries no image", () => {
    const converted = convert([
      { type: "function_call", call_id: "c1", name: "shell", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output: "ok" },
    ]);

    expect(converted.messages.map((message) => message.role)).toEqual(["assistant", "tool"]);
  });

  it("keeps the URL over a scoped file_id and rejects a file_id without a URL", () => {
    const converted = convert([
      { type: "function_call", call_id: "c1", name: "view_image", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output: [{ type: "input_image", image_url: REMOTE_IMAGE, file_id: "file-scoped" }] },
    ]);

    expect(converted.messages.at(-1).content).toEqual([
      { type: "image_url", image_url: { url: REMOTE_IMAGE, detail: "auto" } },
    ]);

    expect(() => convert([
      { type: "function_call", call_id: "c1", name: "view_image", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output: [{ type: "input_image", file_id: "file-scoped" }] },
    ])).toThrow(/file_id is not supported/);
  });
});
