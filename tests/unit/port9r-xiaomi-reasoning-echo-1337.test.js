import { describe, expect, it } from "vitest";
import { injectReasoningContent } from "../../open-sse/utils/reasoningContentInjector.js";
import { XiaomiMimoExecutor } from "../../open-sse/executors/xiaomi-mimo.js";
import { XiaomiTokenplanExecutor } from "../../open-sse/executors/xiaomi-tokenplan.js";

describe("port9r #1337: Xiaomi reasoning_content echo", () => {
  it.each(["xiaomi-tokenplan", "xiaomi-mimo", "xiaomi-mimo-token-plan"])(
    "injects placeholder reasoning_content for %s assistant tool-call turns without mutating input",
    (provider) => {
      const body = {
        model: "mimo-v2.5-pro",
        messages: [
          { role: "user", content: "call a tool" },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "read_file", arguments: "{}" },
              },
            ],
          },
          { role: "tool", tool_call_id: "call-1", content: "ok" },
        ],
      };

      const result = injectReasoningContent({ provider, model: "mimo-v2.5-pro", body });

      expect(result.messages[1].reasoning_content).toBe(" ");
      expect(body.messages[1]).not.toHaveProperty("reasoning_content");
    }
  );

  it.each(["xiaomi-tokenplan", "xiaomi-mimo", "xiaomi-mimo-token-plan"])(
    "injects placeholder reasoning_content for %s plain assistant messages",
    (provider) => {
      const body = {
        model: "mimo-v2.5-pro",
        messages: [{ role: "assistant", content: "plain text" }],
      };

      const result = injectReasoningContent({ provider, model: "mimo-v2.5-pro", body });

      expect(result.messages[0].reasoning_content).toBe(" ");
    }
  );

  it("preserves existing non-empty reasoning_content and reasoning aliases", () => {
    const body = {
      model: "mimo-v2.5-pro",
      messages: [
        {
          role: "assistant",
          content: "",
          reasoning_content: "actual reasoning",
          tool_calls: [{ id: "call-1", type: "function", function: { name: "x", arguments: "{}" } }],
        },
        {
          role: "assistant",
          content: "done",
          reasoning: "alias reasoning",
        },
      ],
    };

    const result = injectReasoningContent({
      provider: "xiaomi-tokenplan",
      model: "mimo-v2.5-pro",
      body,
    });

    expect(result.messages[0].reasoning_content).toBe("actual reasoning");
    expect(result.messages[1]).not.toHaveProperty("reasoning_content");
    expect(result.messages[1].reasoning).toBe("alias reasoning");
  });

  it("injects reasoning_content on OpenAI transport but skips Claude transport in Xiaomi executors", () => {
    const body = {
      model: "mimo-v2.5-pro",
      messages: [{ role: "assistant", content: "hello" }],
    };

    const tp = new XiaomiTokenplanExecutor();
    const tpOpenAI = tp.transformRequest("mimo-v2.5-pro", body, true, {
      runtimeTransport: { format: "openai" },
    });
    const tpClaude = tp.transformRequest("mimo-v2.5-pro", body, true, {
      runtimeTransport: { format: "claude" },
    });

    expect(tpOpenAI.messages[0].reasoning_content).toBe(" ");
    expect(tpClaude.messages[0].reasoning_content).toBeUndefined();

    const mimo = new XiaomiMimoExecutor();
    const mimoOpenAI = mimo.transformRequest("mimo-v2.5-pro", body, true, {
      runtimeTransport: { format: "openai" },
    });
    const mimoClaude = mimo.transformRequest("mimo-v2.5-pro", body, true, {
      runtimeTransport: { format: "claude" },
    });

    expect(mimoOpenAI.messages[0].reasoning_content).toBe(" ");
    expect(mimoClaude.messages[0].reasoning_content).toBeUndefined();
  });
});
