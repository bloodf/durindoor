import { describe, expect, it } from "vitest";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";
import { initState } from "../../open-sse/translator/index.js";
import { resolveResponsesToolName } from "../../open-sse/translator/response/openai-responses.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import "../translator/registerAll.js";

describe("Responses Lite additional tools (#5378)", () => {
  it("lowers additional namespace and custom tools and restores namespace identity", () => {
    const body = { tools: [{ type: "function", name: "other", parameters: { type: "object", properties: {} } }], input: [{ type: "additional_tools", tools: [{ type: "namespace", name: "clock", tools: [{ type: "function", name: "get_time", parameters: { type: "object", properties: {} } }] }, { type: "custom", name: "edit" }] }, { role: "user", content: "hello" }] };
    const out = openaiResponsesToOpenAIRequest("test", body, true, null);
    expect(out.tools.map((tool) => tool.function.name)).toEqual(["other", "clock.get_time", "edit"]);
    expect(out._customToolNames).toContain("edit");
    const state = initState(FORMATS.OPENAI_RESPONSES, body);
    expect(resolveResponsesToolName(state, "clock.get_time")).toMatchObject({ namespace: "clock", name: "get_time" });
  });
});
