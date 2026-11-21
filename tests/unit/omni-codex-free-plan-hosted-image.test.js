import { describe, expect, it } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

function transform(planData, tools, tool_choice) {
  const executor = new CodexExecutor();
  const body = {
    model: "gpt-5.5",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
    tools,
  };
  if (tool_choice !== undefined) body.tool_choice = tool_choice;
  executor.transformRequest("gpt-5.5", body, true, {
    connectionId: "test-codex-free-plan-hosted-image",
    providerSpecificData: planData,
  });
  return body;
}

const tools = [
  { type: "image_generation", output_format: "png" },
  { type: "web_search", search_context_size: "medium" },
  { type: "function", name: "lookup", parameters: { type: "object", properties: {} } },
  { type: "mcp", server_label: "docs", server_url: "https://example.test/mcp" },
];

describe("Codex free-plan CLI hosted image declaration compatibility", () => {
  it.each([
    ["chatgptPlanType", { chatgptPlanType: "FREE", workspacePlanType: "plus" }],
    ["workspacePlanType fallback", { workspacePlanType: "free" }],
  ])("filters only image_generation for explicit free %s", (_label, planData) => {
    const body = transform(planData, structuredClone(tools));
    expect(body.tools.map((tool) => tool.type)).toEqual(["web_search", "function", "mcp"]);
  });

  it("preserves image_generation for paid, unknown, and absent plans", () => {
    for (const planData of [
      { chatgptPlanType: "plus" },
      { chatgptPlanType: "unknown", workspacePlanType: "free" },
      {},
      undefined,
    ]) {
      const body = transform(planData, structuredClone(tools));
      expect(body.tools.map((tool) => tool.type)).toEqual(["image_generation", "web_search", "function", "mcp"]);
    }
  });

  it("keeps explicit hosted image choice when its declaration is filtered", () => {
    const choice = { type: "image_generation" };
    const body = transform({ chatgptPlanType: "free" }, [structuredClone(tools[0])], choice);
    expect(body.tools).toEqual([]);
    expect(body.tool_choice).toEqual(choice);
  });
});
