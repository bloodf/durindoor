import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("OpenCode Go DeepSeek Messages reasoning", () => {
  it("preserves reasoning history and sends effort in Claude fields", () => {
    const model = "deepseek-v4-flash-vision-exp";
    const body = {
      model,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      messages: [
        { role: "user", content: "Look up the weather" },
        { role: "assistant", content: [
          { type: "thinking", thinking: "Check the forecast first." },
          { type: "tool_use", id: "call_weather", name: "weather", input: {} }
        ] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_weather", content: "Sunny" }] }
      ],
      tools: [{ name: "weather", input_schema: { type: "object", properties: {} } }]
    };
    const translated = translateRequest(FORMATS.CLAUDE, FORMATS.CLAUDE, model, body, true, null, "opencode-go");
    expect(translated.thinking).toMatchObject({ type: "adaptive" });
    expect(translated.output_config).toMatchObject({ effort: "high" });
    expect(translated).not.toHaveProperty("reasoning_effort");
    expect(translated.messages[1].content[0]).toEqual({ type: "thinking", thinking: "Check the forecast first." });
  });
});
