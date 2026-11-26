import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

const schema = { type: "object", properties: { facts: { type: "array", items: { type: "string" } } }, required: ["facts"], additionalProperties: false };
const toChat = (text) => translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "m", { input: "hi", text }, true, null, null);

describe("upstream 9router #2783: structured output across the Chat ⇄ Responses hop", () => {
  it("keeps schema and name from a Chat response_format through to the Codex wire body", () => {
    const translated = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "gpt-5.5", {
      messages: [{ role: "user", content: "hi" }],
      response_format: { type: "json_schema", json_schema: { name: "Facts", strict: true, schema } },
    }, true, null, "codex");

    const wire = new CodexExecutor().transformRequest("gpt-5.5", translated, true, {});

    expect(wire.text.format).toMatchObject({ type: "json_schema", name: "Facts", schema, strict: true });
    expect(wire).not.toHaveProperty("response_format");
  });

  it.each([
    [{ verbosity: "low" }],
    [{}],
    [{ format: { type: "text" } }],
  ])("drops the Responses-only text field %j from a Chat body", (text) => {
    const chat = toChat(text);
    expect(chat).not.toHaveProperty("text");
    expect(chat).not.toHaveProperty("response_format");
  });
});
