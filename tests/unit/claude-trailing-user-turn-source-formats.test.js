import "../translator/registerAll.js";
import { describe, expect, it } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { ROLE, GEMINI_ROLE } from "../../open-sse/translator/schema/roles.js";
import { CLAUDE_BLOCK } from "../../open-sse/translator/schema/blocks.js";

const credentials = { rawHeaders: { "x-9router-assistant-prefill": "preserve" } };
const translate = (format, body) => translateRequest(format, FORMATS.CLAUDE,
  "claude-sonnet-4-5", body, false, credentials, "claude");

const formats = [
  ["Gemini", FORMATS.GEMINI, (assistant, emptyUser) => ({ contents: [
    { role: ROLE.USER, parts: [{ text: "hi" }] },
    { role: GEMINI_ROLE.MODEL, parts: [{ text: assistant }] },
    ...(emptyUser ? [{ role: ROLE.USER, parts: [] }] : [])
  ] })],
  ["Responses", FORMATS.OPENAI_RESPONSES, (assistant, emptyUser) => ({ input: [
    { role: ROLE.USER, content: "hi" },
    { role: ROLE.ASSISTANT, content: assistant },
    ...(emptyUser ? [{ role: ROLE.USER, content: [] }] : [])
  ] })]
];

describe("Claude source-format tail intent", () => {
  for (const [name, format, body] of formats) {
    it(`preserves intentional ${name} assistant prefill`, () => {
      const out = translate(format, body("The answer is", false));
      expect(out.messages.map((message) => message.role)).toEqual([ROLE.USER, ROLE.ASSISTANT]);
      expect(out.messages.at(-1).content.some((block) => block.text === "The answer is")).toBe(true);
    });

    it(`restores an emptied ${name} user turn even with the preserve header`, () => {
      const out = translate(format, body("hello", true));
      expect(out.messages.map((message) => message.role)).toEqual([ROLE.USER, ROLE.ASSISTANT, ROLE.USER]);
      expect(out.messages.at(-1).content).toEqual([{ type: CLAUDE_BLOCK.TEXT, text: "Continue." }]);
    });
  }
});
