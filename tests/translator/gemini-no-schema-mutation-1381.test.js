import { describe, expect, it } from "vitest";
import "./registerAll.js";
import {
  openaiToGeminiRequest,
  openaiToGeminiCLIRequest,
} from "../../open-sse/translator/request/openai-to-gemini.js";

const buildBody = () => ({
  model: "gemini-2.5-pro",
  messages: [{ role: "user", content: "hi" }],
  tools: [{
    type: "function",
    function: {
      name: "lookup",
      description: "d",
      parameters: {
        type: "object",
        properties: {
          q: { type: ["string", "null"], format: "email", default: "x" },
          list: { type: "array", items: {} },
        },
        additionalProperties: false,
      },
    },
  }],
  response_format: {
    type: "json_schema",
    json_schema: { name: "r", schema: { type: "object", properties: { a: { type: ["string", "null"] } } } },
  },
});

describe("#1381 openai-to-gemini does not mutate the caller's schemas", () => {
  for (const [name, fn] of [["gemini", openaiToGeminiRequest], ["gemini-cli", openaiToGeminiCLIRequest]]) {
    it(`${name}: request body equals its pre-call clone`, () => {
      const body = buildBody();
      const before = structuredClone(body);
      const out = fn("gemini-2.5-pro", body, false);
      expect(body).toEqual(before);
      const params = out.tools[0].functionDeclarations[0].parameters;
      expect(params).not.toBe(body.tools[0].function.parameters);
      expect(params.properties.q.type).toBe("string");
    });
  }
});
