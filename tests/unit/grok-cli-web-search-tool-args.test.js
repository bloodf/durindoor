import { describe, expect, it } from "vitest";
import { GrokCliExecutor } from "../../open-sse/executors/grok-cli.js";

// Upstream OmniRoute#14609: Codex CLI declares its native search as a Responses tool
// `{ type: "web_search", external_web_access: false }`. When search interception is
// off for grok-cli, that tool reaches Grok Build verbatim and the whole turn fails:
//   400 Argument not supported: external_web_access
// (`search_context_size` fails the same way). transformRequest() must drop those
// OpenAI-only arguments and keep the tool, so Grok still runs its own web search.
// `user_location`, `filters` and `allowed_domains` are accepted and must survive.
function transform(body) {
  const executor = new GrokCliExecutor();
  return executor.transformRequest("grok-build", body, true, {});
}

describe("grok-cli web_search tool args (omniroute-14609)", () => {
  it("drops external_web_access from the native web_search tool, keeps the tool", () => {
    const body = {
      model: "grok-build",
      input: [{ role: "user", content: "news?" }],
      tools: [
        { type: "web_search", external_web_access: false },
        { type: "function", name: "shell", parameters: { type: "object", properties: {} } },
      ],
    };

    const out = transform(body);

    expect(out.tools).toEqual([
      { type: "web_search" },
      { type: "function", name: "shell", parameters: { type: "object", properties: {} } },
    ]);
  });

  it("drops search_context_size and keeps arguments Grok accepts", () => {
    const out = transform({
      model: "grok-build",
      input: "hi",
      tools: [
        {
          type: "web_search",
          external_web_access: true,
          search_context_size: "low",
          filters: { allowed_domains: ["x.ai"] },
          user_location: { type: "approximate", country: "VN" },
        },
      ],
    });

    expect(out.tools).toEqual([
      {
        type: "web_search",
        filters: { allowed_domains: ["x.ai"] },
        user_location: { type: "approximate", country: "VN" },
      },
    ]);
  });

  it("leaves tools without web_search untouched", () => {
    const tools = [{ type: "function", name: "shell", parameters: { type: "object", properties: {} } }];

    const out = transform({ model: "grok-build", input: "hi", tools });

    expect(out.tools).toEqual(tools);
  });
});
