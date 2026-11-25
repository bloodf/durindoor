import { describe, expect, it } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";
import { validateSearchRoute } from "../../open-sse/translator/concerns/searchRouting.js";

const search = { type: "web_search_20250305", name: "web_search", max_uses: 3, allowed_domains: ["example.test"] };
const request = () => ({
  model: "claude-sonnet-4-6", max_tokens: 100,
  messages: [{ role: "user", content: "Find it" }],
  tools: [search], tool_choice: { type: "tool", name: "web_search" },
});

describe("Anthropic native search declaration (#5496)", () => {
  it.each(["anthropic", "claude", "anthropic-compatible-example"])("preserves the admitted native tool and choice on %s", (provider) => {
    const body = request();
    expect(validateSearchRoute(body, FORMATS.CLAUDE, FORMATS.CLAUDE, provider)).toBeNull();
    const out = prepareClaudeRequest(body, provider);
    expect(out.tools[0]).toMatchObject(search);
    expect(out.tool_choice).toEqual({ type: "tool", name: "web_search" });
  });

  it("retains unsupported route validation and filtering", () => {
    const body = request();
    expect(validateSearchRoute(body, FORMATS.CLAUDE, FORMATS.OPENAI, "openai")).toMatch(/not supported/);
    const out = prepareClaudeRequest(body, "openai");
    expect(out.tools).toBeUndefined();
    expect(out.tool_choice).toBeUndefined();
  });
});
