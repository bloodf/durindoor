import { describe, expect, it } from "vitest";
import { dedupeTools } from "../../open-sse/utils/toolDeduper.js";

const tool = (name, marker = name) => ({ name, description: marker });

const MCP_CASES = [
  {
    label: "Exa",
    tools: [tool("mcp__exa__web_search_exa"), tool("WebSearch")],
    retained: ["mcp__exa__web_search_exa"],
  },
  {
    label: "Tavily",
    tools: [tool("mcp__tavily__tavily_search"), tool("WebFetch")],
    retained: ["mcp__tavily__tavily_search"],
  },
  {
    label: "Browser MCP",
    tools: [tool("mcp__browsermcp__browser_navigate"), tool("mcp__Claude_in_Chrome__navigate")],
    retained: ["mcp__browsermcp__browser_navigate"],
  },
];

describe("dedupeTools DeepSeek duplicate handling", () => {
  it.each([
    "accounts/fireworks/models/deepseek-v4-pro",
    "DeepSeek-V4-Flash",
    "DeepSeek-V4-Pro",
    "deepseek/DeepSeek-R1",
    "deepseek/deepseek-v3",
    "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
    "deepseek-chat",
    "deepseek-ai/deepseek-r1",
  ])("keeps the first same-name definition for %s", (model) => {
    const first = tool("lookup", "first");
    const second = tool("lookup", "second");

    const { tools, stripped } = dedupeTools([first, second], { model });

    expect(tools).toEqual([first]);
    expect(tools[0]).toBe(first);
    expect(stripped).toEqual(["lookup"]);
  });

  it.each([
    "glm-5.2",
    "vendor/not-deepseek-compatible",
  ])("leaves duplicate names untouched for non-DeepSeek model %s", (model) => {
    const duplicates = [tool("lookup", "first"), tool("lookup", "second")];

    const { tools, stripped } = dedupeTools(duplicates, { model });

    expect(tools).toBe(duplicates);
    expect(stripped).toEqual([]);
  });
});

describe.each(MCP_CASES)("dedupeTools $label MCP rules", ({ tools: configuredTools, retained }) => {
  it("strips the configured built-in for Claude", () => {
    const { tools } = dedupeTools(configuredTools, { clientTool: "claude", model: "claude-sonnet-4-6" });

    expect(tools.map(({ name }) => name)).toEqual(retained);
  });

  it("leaves the configured built-in untouched for non-Claude clients", () => {
    const { tools, stripped } = dedupeTools(configuredTools, { clientTool: "codex", model: "gpt-5.4" });

    expect(tools).toBe(configuredTools);
    expect(stripped).toEqual([]);
  });
});
