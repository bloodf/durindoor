import { describe, it, expect } from "vitest";
import { antigravityToOpenAIRequest } from "../../open-sse/translator/request/antigravity-to-openai.js";

const messages = (contents) => antigravityToOpenAIRequest("m", { request: { contents } }, false).messages;

describe("OmniRoute #20205: Antigravity turn roles", () => {
  it("keeps a user follow-up beside a tool result as a user message", () => {
    const result = messages([{ role: "user", parts: [{ functionResponse: { id: "c1", name: "run", response: { result: "ok" } } }, { text: "now continue" }] }]);
    expect(result.map((message) => message.role)).toEqual(["tool", "user"]);
  });

  it("gives role-less contents the role their parts imply", () => {
    expect(messages([{ parts: [{ text: "hi" }] }])).toEqual([{ role: "user", content: "hi" }]);
    expect(messages([{ parts: [{ functionCall: { id: "c1", name: "run", args: {} } }] }])[0].role).toBe("assistant");
  });
});
