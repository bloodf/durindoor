import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { ROLE, CLAUDE_BLOCK, RESPONSES_ITEM } from "../../open-sse/translator/schema/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";

describe.each([false, true])("Cursor nested Responses output (stream=%s)", (stream) => {
  it.each([FORMATS.OPENAI, FORMATS.CURSOR])("classifies serialized tool blocks on %s registered input", (source) => {
    const text = "Literal example: data:image/png;base64,AAAA";
    const bodyFor = (block) => ({ stream, messages: [
      { role: ROLE.ASSISTANT, content: "", tool_calls: [
        { id: "call_1", type: "function", function: { name: "inspect", arguments: "{}" } },
      ] },
      { role: ROLE.TOOL, tool_call_id: "call_1", content: JSON.stringify([
        { type: CLAUDE_BLOCK.TOOL_RESULT, tool_use_id: "nested", content: [block] },
      ]) },
    ] });
    const textBody = bodyFor({ type: CLAUDE_BLOCK.TEXT, text });
    const out = translateRequest(source, FORMATS.CURSOR, "default", textBody, stream, null, "cursor");
    expect(JSON.stringify(out.messages)).toContain(text);
    const imageBody = bodyFor({ type: RESPONSES_ITEM.INPUT_IMAGE, image_url: "https://example.invalid/download/123" });
    const original = structuredClone(imageBody);
    expect(() => translateRequest(source, FORMATS.CURSOR, "default", imageBody, stream, null, "cursor"))
      .toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(imageBody).toEqual(original);
  });


});

describe.each([false, true])("Cursor custom Responses output (stream=%s)", (stream) => {
  const imageBody = (provider) => ({
      model: `${provider}/default`, stream,
      input: [
        { type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: "inspect" },
        { type: RESPONSES_ITEM.CUSTOM_TOOL_CALL_OUTPUT, call_id: "call_1", output: [
          { type: CLAUDE_BLOCK.TOOL_RESULT, tool_use_id: "nested", content: [
            { type: RESPONSES_ITEM.INPUT_IMAGE, image_url: "https://example.invalid/download/123" },
          ] },
        ] },
      ],
  });

  it.each(["cursor", "cu"])("rejects %s typed images through registration", (provider) => {
    const body = imageBody(provider);
    const original = structuredClone(body);
    expect(() => translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.CURSOR, "default", body, stream, null, provider))
      .toThrow(expect.objectContaining({ statusCode: 400, message: expect.stringContaining("Cursor image input is not supported") }));
    expect(body).toEqual(original);
  });

  it.each(["cursor", "cu"])("allows %s ordinary custom tool JSON mentioning images", (provider) => {
    const body = {
      model: `${provider}/default`, stream,
      input: [
        { type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: "inspect" },
        { type: RESPONSES_ITEM.CUSTOM_TOOL_CALL_OUTPUT, call_id: "call_1", output: {
          type: "image", image_url: "https://example.invalid/photo.png",
        } },
      ],
    };
    const original = structuredClone(body);
    const translated = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.CURSOR, "default", structuredClone(body), stream, null, provider);
    expect(translated.messages).toEqual([{ role: ROLE.USER, content: "inspect" }]);
    expect(body).toEqual(original);

  });
});
