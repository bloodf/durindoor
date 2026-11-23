import { describe, expect, it } from "vitest";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";

describe("Responses custom tool normalization", () => {
  it("preserves the grammar while exposing a required string input", () => {
    const result = openaiResponsesToOpenAIRequest("model", {
      input: [{ role: "user", content: "Fix it" }],
      tools: [{ type: "custom", name: "apply_patch", description: "Apply a patch", format: { type: "grammar", syntax: "lark", definition: "start: PATCH" } }]
    }, true, null);

    expect(result.tools[0].function).toEqual({
      name: "apply_patch",
      description: "Apply a patch\n\nlark\nstart: PATCH",
      parameters: {
        type: "object",
        properties: { input: { type: "string", description: "Raw freeform input for this custom tool" } },
        required: ["input"],
        additionalProperties: false
      }
    });
    expect(result._customToolNames).toEqual(["apply_patch"]);
  });
});
