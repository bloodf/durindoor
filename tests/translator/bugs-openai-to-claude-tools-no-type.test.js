/**
 * Regression (decolua/9router ddd5509e9, #2473): bare `{ function: {...} }`
 * tools lacking a parent `type:"function"` were forwarded to the Claude
 * provider with `name: "undefined"`, because openai-to-claude only unwrapped
 * `tool.function` when BOTH `tool.type === "function"` AND `tool.function`
 * were truthy. The fix unwraps `tool.function ?? tool`.
 */
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// anthropic-compatible provider so prepareClaudeRequest runs the openai→claude leg.
const T = (body) =>
  translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "m", body, true, null, "anthropic-compatible-x");

const base = (extra = {}) => ({
  messages: [{ role: "user", content: "hi" }],
  ...extra,
});

describe("openai→claude: tool shape fidelity (#2473)", () => {
  it("tool WITH explicit type:'function' is rewritten to Anthropic shape", () => {
    const out = T(base({
      tools: [
        { type: "function", function: { name: "echo", parameters: { type: "object" } } },
      ],
    }));

    expect(out.tools).toHaveLength(1);
    expect(out.tools[0]).toMatchObject({
      name: "echo",
      description: "",
      input_schema: { type: "object" },
      cache_control: { type: "ephemeral", ttl: "1h" },
    });
    // Anthropic-shape has no top-level `type` and no nested `function`.
    expect(out.tools[0]).not.toHaveProperty("type");
    expect(out.tools[0]).not.toHaveProperty("function");
  });

  it("bare {function:{...}} tool WITHOUT parent type unwraps to the real name (was 'undefined' in v0.5.20)", () => {
    const out = T(base({
      tools: [
        { function: { name: "echo", description: "echo input", parameters: { type: "object" } } },
      ],
    }));

    expect(out.tools).toHaveLength(1);
    expect(out.tools[0]).toMatchObject({
      name: "echo",
      description: "echo input",
      input_schema: { type: "object" },
      cache_control: { type: "ephemeral", ttl: "1h" },
    });
    expect(out.tools[0].name).not.toBe("undefined");
    // OpenAI `function` wrapper is fully stripped.
    expect(out.tools[0]).not.toHaveProperty("function");
    expect(out.tools[0]).not.toHaveProperty("type");
  });

  it("flat Anthropic-shape tool (no function wrapper) is passed through with name preserved", () => {
    const out = T(base({
      tools: [
        { name: "echo", description: "echo input", input_schema: { type: "object" } },
      ],
    }));

    expect(out.tools).toHaveLength(1);
    expect(out.tools[0]).toMatchObject({
      name: "echo",
      description: "echo input",
      input_schema: { type: "object" },
      cache_control: { type: "ephemeral", ttl: "1h" },
    });
  });
});
