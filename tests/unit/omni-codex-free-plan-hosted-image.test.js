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
    ["trimmed chatgptPlanType", { chatgptPlanType: "  FrEe \t", workspacePlanType: "plus" }],
    ["workspacePlanType fallback", { workspacePlanType: "free" }],
    ["trimmed workspacePlanType fallback", { workspacePlanType: "  FREE  " }],
  ])("filters only image_generation for explicit free %s", (_label, planData) => {
    const body = transform(planData, structuredClone(tools));
    expect(body.tools.map((tool) => tool.type)).toEqual(["web_search", "function", "mcp"]);
  });

  it("preserves image_generation for paid, unknown, and absent plans", () => {
    for (const planData of [
      { chatgptPlanType: "plus" },
      { chatgptPlanType: "unknown", workspacePlanType: "free" },
      { chatgptPlanType: 1, workspacePlanType: "free" },
      {},
      undefined,
    ]) {
      const body = transform(planData, structuredClone(tools));
      expect(body.tools.map((tool) => tool.type)).toEqual(["image_generation", "web_search", "function", "mcp"]);
    }
  });

  it("preserves the declaration for an explicit hosted image choice", () => {
    const choice = { type: "image_generation" };
    const body = transform({ chatgptPlanType: "free" }, [structuredClone(tools[0])], choice);
    expect(body.tools).toEqual([tools[0]]);
    expect(body.tool_choice).toEqual(choice);
  });

  it("preserves image_generation when required choice has no other executable option", () => {
    const body = transform({ chatgptPlanType: "free" }, [structuredClone(tools[0])], "required");
    expect(body.tools).toEqual([tools[0]]);
    expect(body.tool_choice).toBe("required");
  });

  it("filters image_generation for required choice when another executable option remains", () => {
    const body = transform({ chatgptPlanType: "free" }, [
      structuredClone(tools[0]), structuredClone(tools[2]),
    ], "required");
    expect(body.tools.map((tool) => tool.type)).toEqual(["function"]);
    expect(body.tool_choice).toBe("required");
  });
});
