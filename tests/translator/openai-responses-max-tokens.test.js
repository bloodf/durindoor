import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const chatBody = (tokens) => ({
  messages: [{ role: "user", content: "say OK" }],
  max_tokens: tokens,
});

describe("Chat Completions output limit at the transport boundary", () => {
  it("renames max_tokens for a Responses transport", () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      "responses-only-model",
      chatBody(8),
    );

    expect(out.max_output_tokens).toBe(8);
    expect(out).not.toHaveProperty("max_tokens");
  });

  it("does not overwrite an explicit Responses output limit", () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      "responses-only-model",
      { ...chatBody(8), max_output_tokens: 13 },
    );

    expect(out.max_output_tokens).toBe(13);
    expect(out).not.toHaveProperty("max_tokens");
  });

  it("renames max_tokens when a Responses input envelope takes the early path", () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      "responses-only-model",
      { input: [{ role: "user", content: "say OK" }], max_tokens: 8 },
    );

    expect(out.max_output_tokens).toBe(8);
    expect(out).not.toHaveProperty("max_tokens");
  });

  it("keeps max_tokens for a normal Chat Completions transport", () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI,
      "chat-completions-model",
      chatBody(8),
    );

    expect(out.max_tokens).toBe(8);
    expect(out).not.toHaveProperty("max_output_tokens");
  });
});
