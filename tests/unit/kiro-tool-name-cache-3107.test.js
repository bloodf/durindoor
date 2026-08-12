import { describe, expect, it } from "vitest";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";
import { kiroToClaudeResponse } from "../../open-sse/translator/response/kiro-to-claude.js";
import { kiroToOpenAIResponse } from "../../open-sse/translator/response/kiro-to-openai.js";

const sanitizedName = "codex_app_send_message_to_thread";
const originalName = "codex_app__send_message_to_thread";
const toolNameMap = new Map([[sanitizedName, originalName]]);

describe("Kiro tool names and Claude cache usage", () => {
  it("keeps reverse mapping for Kiro-sanitized tool names", () => {
    const result = openaiToKiroRequest("claude-sonnet-4.6", {
      messages: [{ role: "user", content: "Send update" }],
      tools: [{
        type: "function",
        function: {
          name: originalName,
          description: "Send message",
          parameters: { type: "object", properties: {} },
        },
      }],
    }, true, {});

    const tools = result.conversationState.currentMessage.userInputMessage.userInputMessageContext.tools;
    expect(tools[0].toolSpecification.name).toBe(sanitizedName);
    expect(result._toolNameMap).toEqual(toolNameMap);
  });

  it("restores original tool names in OpenAI and Claude response translators", () => {
    const openAIResult = kiroToOpenAIResponse({
      _eventType: "toolUseEvent",
      toolUseEvent: { toolUseId: "tool-1", name: sanitizedName, input: {} },
    }, { toolNameMap });
    expect(openAIResult.choices[0].delta.tool_calls[0].function.name).toBe(originalName);

    const claudeResult = kiroToClaudeResponse({
      id: "chatcmpl-1",
      model: "kiro",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "tool-1", function: { name: sanitizedName, arguments: "" } }] } }],
    }, { toolNameMap });
    expect(claudeResult.find((event) => event.type === "content_block_start").content_block.name).toBe(originalName);
  });

  // The live Kiro route never reaches the raw toolUseEvent branch above: the
  // executor converts the binary EventStream into OpenAI chunks itself
  // (KiroExecutor.transformEventStreamToSSE), and kiroToOpenAIResponse
  // early-returns anything already shaped as chat.completion.chunk. Restoring
  // names only in the raw branch left the production path emitting the
  // sanitized name to clients.
  it("restores tool names on executor-produced OpenAI chunks", () => {
    const executorChunk = {
      id: "chatcmpl-1",
      object: "chat.completion.chunk",
      model: "kiro",
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, id: "tool-1", type: "function", function: { name: sanitizedName, arguments: "" } }] },
        finish_reason: null,
      }],
    };

    const result = kiroToOpenAIResponse(executorChunk, { toolNameMap });

    expect(result.choices[0].delta.tool_calls[0].function.name).toBe(originalName);
    // Kiro credit stripping must still work on the same branch.
    const withCredits = kiroToOpenAIResponse(
      { ...executorChunk, usage: { kiro_credits: 2, kiro_credit_unit: "credit" } },
      { toolNameMap },
    );
    expect(withCredits.usage).toBeUndefined();
    expect(withCredits.choices[0].delta.tool_calls[0].function.name).toBe(originalName);
  });

  it("leaves unmapped tool names untouched on executor chunks", () => {
    const chunk = {
      object: "chat.completion.chunk",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "t", function: { name: "plain_tool", arguments: "" } }] } }],
    };
    expect(kiroToOpenAIResponse(chunk, { toolNameMap }).choices[0].delta.tool_calls[0].function.name).toBe("plain_tool");
    // No map at all must not throw.
    expect(kiroToOpenAIResponse(chunk, {}).choices[0].delta.tool_calls[0].function.name).toBe("plain_tool");
  });

  it("preserves flat and nested cache token usage fields in Claude message_delta", () => {
    const state = {};
    kiroToClaudeResponse({
      id: "chatcmpl-1",
      model: "kiro",
      usage: {
        prompt_tokens: 12,
        completion_tokens: 3,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: 7,
        prompt_tokens_details: {
          cache_read_input_tokens: 11,
          cache_creation_input_tokens: 13,
        },
      },
      choices: [{ delta: {} }],
    }, state);
    const events = kiroToClaudeResponse({
      choices: [{ delta: {}, finish_reason: "stop" }],
    }, state);
    const usage = events.find((event) => event.type === "message_delta").usage;

    expect(usage).toMatchObject({
      input_tokens: 12,
      output_tokens: 3,
      cache_read_input_tokens: 5,
      cache_creation_input_tokens: 7,
    });
  });
});
