import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";

// Poe returns 400 for a user message whose content is image-only.
const PLACEHOLDER = "[Image(s) attached]";
const IMG = "data:image/png;base64,iVBORw0KGgo=";

const claudeToolResultImage = () => ({
  model: "m",
  max_tokens: 64,
  messages: [
    { role: "user", content: "Read /tmp/x.png" },
    { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: {} }] },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: [{ type: "image", source: { type: "url", url: "https://example.com/x.png" } }],
        },
      ],
    },
  ],
  tools: [{ name: "Read", description: "Read", input_schema: { type: "object", properties: {} } }],
});

const last = (out) => out.messages[out.messages.length - 1];

describe("Poe image-only user turn", () => {
  it("claude tool_result image: poe gets a leading text part, other providers do not", () => {
    const poe = last(translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "m", claudeToolResultImage(), false, null, "poe"));
    expect(poe.role).toBe("user");
    expect(poe.content[0]).toEqual({ type: "text", text: PLACEHOLDER });
    expect(poe.content[1].type).toBe("image_url");

    const other = last(translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "m", claudeToolResultImage(), false, null, "openai"));
    expect(other.content.every((p) => p.type === "image_url")).toBe(true);
  });

  it("same-format openai passthrough: image-only turn fixed for poe only", () => {
    const body = () => ({ model: "m", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: IMG } }] }] });
    const poe = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "m", body(), false, null, "poe");
    expect(poe.messages[0].content[0]).toEqual({ type: "text", text: PLACEHOLDER });
    expect(poe.messages[0].content).toHaveLength(2);

    const other = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "m", body(), false, null, "openai");
    expect(other.messages[0].content).toHaveLength(1);
  });

  it("poe: user turn that already has text is not modified", () => {
    const content = [{ type: "text", text: "what colour?" }, { type: "image_url", image_url: { url: IMG } }];
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "m", { model: "m", messages: [{ role: "user", content }] }, false, null, "poe");
    expect(out.messages[0].content).toEqual(content);
  });

  it("same-format openai passthrough: image part is also fixed for poe", () => {
    const part = { type: "image", source: { type: "url", url: "https://example.com/x.png" } };
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "m", { model: "m", messages: [{ role: "user", content: [part] }] }, false, null, "poe");
    expect(out.messages[0].content).toEqual([{ type: "text", text: PLACEHOLDER }, part]);
  });
});
