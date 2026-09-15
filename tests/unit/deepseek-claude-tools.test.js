/**
 * Port of upstream decolua/9router PR #3947 (landed on master as 45ec1d30).
 *
 * DeepSeek's Anthropic-compatible endpoint
 * (https://api.deepseek.com/anthropic/v1/messages) accepts ONLY the built-in
 * web_search_* tools. Client-defined tools arrive as `type: "custom"` and are
 * rejected with HTTP 400 "tools[0]: unknown variant `custom`". The generic
 * non-Anthropic filter dropped those custom tools but ALSO dropped the
 * web_search_* tools DeepSeek does accept, and stripped their `type`, which the
 * upstream needs to route a built-in.
 *
 * `quirks.claudeSupportedToolTypes` whitelists the accepted `type` values;
 * prepareClaudeRequest keeps those tools with `type` intact and drops the rest.
 */

import { describe, expect, it } from "vitest";
import { prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";

const makeBody = (tools) => ({
  model: "deepseek-v4-pro",
  max_tokens: 1024,
  messages: [{ role: "user", content: "hello" }],
  tools,
  tool_choice: { type: "auto" },
});

describe("prepareClaudeRequest tool filtering for deepseek", () => {
  it("declares the whitelist quirk on the deepseek provider", () => {
    expect(PROVIDERS.deepseek.quirks.claudeSupportedToolTypes).toEqual([
      "web_search_20250305",
      "web_search_20260209",
    ]);
  });

  it("drops client-defined custom tools DeepSeek rejects with 400", () => {
    const out = prepareClaudeRequest(
      makeBody([
        { type: "custom", name: "Bash", input_schema: { type: "object" } },
        { type: "custom", name: "Read", input_schema: { type: "object" } },
      ]),
      "deepseek",
    );

    expect(out.tools).toBeUndefined();
    expect(out.tool_choice).toBeUndefined();
  });

  it("keeps whitelisted web_search tools with their type intact", () => {
    const out = prepareClaudeRequest(
      makeBody([
        { type: "web_search_20250305", name: "web_search" },
        { type: "custom", name: "Bash", input_schema: { type: "object" } },
        { type: "web_search_20260209", name: "web_search" },
      ]),
      "deepseek",
    );

    expect(out.tools.map((tool) => tool.type)).toEqual([
      "web_search_20250305",
      "web_search_20260209",
    ]);
  });

  it("still folds OpenAI function tools into Anthropic shape", () => {
    const out = prepareClaudeRequest(
      makeBody([
        {
          type: "function",
          function: { name: "get_time", description: "now", parameters: { type: "object" } },
        },
      ]),
      "deepseek",
    );

    expect(out.tools[0]).toMatchObject({
      name: "get_time",
      description: "now",
      input_schema: { type: "object" },
    });
    expect(out.tools[0].type).toBeUndefined();
  });

  it("leaves providers without the quirk on the strip-everything path", () => {
    const out = prepareClaudeRequest(
      makeBody([
        { type: "web_search_20250305", name: "web_search" },
        { name: "typeless_tool", input_schema: { type: "object" } },
      ]),
      "openai",
    );

    // cache_control is anchored on the last cacheable tool by the surrounding
    // pass; the contract under test is which tools survive and their shape.
    expect(out.tools).toHaveLength(1);
    expect(out.tools[0]).toMatchObject({
      name: "typeless_tool",
      input_schema: { type: "object" },
    });
    expect(out.tools[0].type).toBeUndefined();
  });
});
