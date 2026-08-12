/**
 * Unit tests for open-sse/translator/request/openai-to-kiro.js
 *
 * Tests cover:
 *  - openaiToKiroRequest() - basic message conversion
 *  - Image forwarding fix: images in currentMessage must be included in payload
 */

import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { resolveKiroTranslationModel } from "../../open-sse/handlers/chatCore.js";

const contentOf = (result) =>
  result.conversationState.currentMessage.userInputMessage.content;

const modelIdOf = (result) =>
  result.conversationState.currentMessage.userInputMessage.modelId;

describe("openaiToKiroRequest", () => {
  describe("basic message conversion", () => {
    it("should convert a simple text message", () => {
      const body = {
        messages: [{ role: "user", content: "Hello" }]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      const currentMsg = result.conversationState.currentMessage;
      expect(currentMsg.userInputMessage.content).toContain("Hello");
      expect(currentMsg.userInputMessage.modelId).toBe("claude-sonnet-4.6");
      expect(currentMsg.userInputMessage.origin).toBe("AI_EDITOR");
    });

    it("should not include images field when no images are present", () => {
      const body = {
        messages: [{ role: "user", content: "No images here" }]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      const currentMsg = result.conversationState.currentMessage;
      expect(currentMsg.userInputMessage.images).toBeUndefined();
    });
  });

  describe("image forwarding", () => {
    it("should forward base64 image from image_url content part", () => {
      const fakeBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const body = {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this image" },
              { type: "image_url", image_url: { url: `data:image/png;base64,${fakeBase64}` } }
            ]
          }
        ]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      const currentMsg = result.conversationState.currentMessage;
      expect(currentMsg.userInputMessage.images).toBeDefined();
      expect(currentMsg.userInputMessage.images).toHaveLength(1);
      expect(currentMsg.userInputMessage.images[0].format).toBe("png");
      expect(currentMsg.userInputMessage.images[0].source.bytes).toBe(fakeBase64);
    });

    it("should forward multiple base64 images", () => {
      const fakeBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const body = {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Compare these images" },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${fakeBase64}` } },
              { type: "image_url", image_url: { url: `data:image/png;base64,${fakeBase64}` } }
            ]
          }
        ]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      const currentMsg = result.conversationState.currentMessage;
      expect(currentMsg.userInputMessage.images).toHaveLength(2);
      expect(currentMsg.userInputMessage.images[0].format).toBe("jpeg");
      expect(currentMsg.userInputMessage.images[1].format).toBe("png");
    });

    it("should not include images field when images array is empty", () => {
      const body = {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Just text" }
            ]
          }
        ]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      const currentMsg = result.conversationState.currentMessage;
      expect(currentMsg.userInputMessage.images).toBeUndefined();
    });

    it("should include both images and text content together", () => {
      const fakeBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const body = {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "What is in this image?" },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${fakeBase64}` } }
            ]
          }
        ]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      const currentMsg = result.conversationState.currentMessage;
      expect(currentMsg.userInputMessage.content).toContain("What is in this image?");
      expect(currentMsg.userInputMessage.images).toHaveLength(1);
    });

    it("should treat http image URLs as text fallback (Kiro only supports base64)", () => {
      const body = {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Look at this" },
              { type: "image_url", image_url: { url: "https://example.com/photo.jpg" } }
            ]
          }
        ]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      const currentMsg = result.conversationState.currentMessage;
      // HTTP URLs are not supported by Kiro — converted to text placeholder
      expect(currentMsg.userInputMessage.images).toBeUndefined();
      expect(currentMsg.userInputMessage.content).toContain("[Image: https://example.com/photo.jpg]");
    });
  });

  describe("tool interaction without client-provided tools", () => {
    // When the client omits `tools` (e.g. after compaction), structured tool
    // content must be flattened to text so Kiro's "tools required" 400 never
    // fires and no phantom tool-calling capability is advertised.

    it("should flatten OpenAI tool_calls + tool result into history text with no tools array", () => {
      const body = {
        messages: [
          { role: "user", content: "Read the file" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.txt"}' } }
            ]
          },
          { role: "tool", tool_call_id: "call_1", content: "file contents here" },
          { role: "user", content: "Summarize it" }
        ]
        // note: no `tools`
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});
      const cs = result.conversationState;

      // No structured tool content anywhere
      expect(cs.currentMessage.userInputMessage.userInputMessageContext).toBeUndefined();
      const allJson = JSON.stringify(cs);
      expect(allJson).not.toContain("toolUses");
      expect(allJson).not.toContain("toolResults");

      // Tool call + result preserved as readable text (call lands in history,
      // result merges into the final currentMessage — assert across both)
      expect(allJson).toContain("[Tool call: read_file(");
      expect(allJson).toContain("[Tool result: file contents here]");
    });

    it("should flatten Claude tool_use / tool_result blocks with no tools array", () => {
      const body = {
        messages: [
          { role: "user", content: "Do it" },
          {
            role: "assistant",
            content: [
              { type: "text", text: "Calling tool" },
              { type: "tool_use", id: "tu_1", name: "search", input: { q: "kiro" } }
            ]
          },
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "tu_1", content: "result text" }
            ]
          }
        ]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});
      const cs = result.conversationState;

      const allJson = JSON.stringify(cs);
      expect(allJson).not.toContain("toolUses");
      expect(allJson).not.toContain("toolResults");
      expect(allJson).toContain("[Tool call: search(");
      expect(allJson).toContain("[Tool result: result text]");
    });

    it("should keep structured tools when the client DOES provide a tools array", () => {
      const body = {
        messages: [
          { role: "user", content: "Read the file" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.txt"}' } }
            ]
          },
          { role: "tool", tool_call_id: "call_1", content: "file contents here" },
          { role: "user", content: "Summarize it" }
        ],
        tools: [
          {
            type: "function",
            function: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }
          }
        ]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});
      const cs = result.conversationState;

      // Structured tool spec carried on currentMessage
      const tools = cs.currentMessage.userInputMessage.userInputMessageContext?.tools;
      expect(tools).toBeDefined();
      expect(tools[0].toolSpecification.name).toBe("read_file");

      // Structured tool history preserved (not flattened to text)
      const allJson = JSON.stringify(cs);
      expect(allJson).toContain("toolUses");
      expect(allJson).not.toContain("[Tool call:");
    });

    it("canonicalizes unsupported tool schema keywords while preserving valid structure", () => {
      const result = openaiToKiroRequest("claude-sonnet-4.6", {
        messages: [{ role: "user", content: "Search" }],
        tools: [{
          type: "function",
          function: {
            name: "search",
            parameters: {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    query: { type: "string", description: "Search query", $ref: "#/$defs/Query" },
                  },
                  required: ["query"],
                },
              ],
              $defs: { Query: { type: "string" } },
            },
          },
        }],
      }, true, {});

      const schema = result.conversationState.currentMessage.userInputMessage
        .userInputMessageContext.tools[0].toolSpecification.inputSchema.json;
      expect(schema).toEqual({
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      });
    });

    it("should salvage orphaned tool_result content as text instead of discarding it", () => {
      // Client provides tools, but compaction removed the assistant tool_use
      // message, leaving a tool_result whose tool_use_id matches nothing.
      const body = {
        messages: [
          { role: "user", content: "Start" },
          // (assistant tool_use for "orphan_call" was compacted away)
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "orphan_call", content: "important orphaned output" }
            ]
          },
          { role: "user", content: "Now continue" }
        ],
        tools: [
          {
            type: "function",
            function: { name: "some_tool", description: "x", parameters: { type: "object", properties: {}, required: [] } }
          }
        ]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});
      const cs = result.conversationState;
      const allJson = JSON.stringify(cs);

      // The dangling structured reference is gone (would trigger Kiro 400)...
      expect(allJson).not.toContain("orphan_call");
      // ...but the content is preserved as salvaged text, not discarded.
      expect(allJson).toContain("[Tool result: important orphaned output]");
    });

    it("does not inject a fake 'continue' user message on a tool-result-only turn", () => {
      // Regression: in an agentic loop the turn after an assistant tool_use is
      // tool-results-only with no user text. The translator must NOT substitute
      // the literal word "continue" (Kiro accepts empty content when toolResults
      // are present, and "continue" leaks into the visible conversation as if the
      // user typed it). See openai-to-kiro.js flushPending.
      const body = {
        messages: [
          { role: "user", content: "What is 2+2? Use the calc tool." },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "calc", arguments: '{"expr":"2+2"}' } }
            ]
          },
          { role: "tool", tool_call_id: "call_1", content: "4" }
        ],
        tools: [
          { type: "function", function: { name: "calc", description: "Eval", parameters: { type: "object", properties: { expr: { type: "string" } }, required: ["expr"] } } }
        ]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.5", body, true, {});
      const current = result.conversationState.currentMessage.userInputMessage;

      // The current (tool-result) turn carries the tool results...
      expect(current.userInputMessageContext.toolResults).toBeDefined();
      expect(current.userInputMessageContext.toolResults[0].toolUseId).toBe("call_1");
      // ...and its user body (content minus any injected system prefix) is empty,
      // NOT the literal "continue".
      const body0 = current.content.split("\n\n").pop();
      expect(body0).toBe("");
      expect(current.content).not.toMatch(/(^|\n)continue$/);
    });
  });

  describe("thinking budget", () => {
    it("does not infer thinking from sentinel words inside an opaque suffix", () => {
      for (const model of [
        "claude-sonnet-4.6(custom-thinking)",
        "claude-sonnet-4.6(custom-reason)",
      ]) {
        const result = openaiToKiroRequest(
          model,
          { messages: [{ role: "user", content: "hello" }] },
          true,
          {},
        );
        expect(contentOf(result)).not.toContain("<thinking_mode>");
        expect(result.conversationState.currentMessage.userInputMessage.modelId).toBe(model);
      }
    });

    it("uses request-scoped suffix intent with a clean model ID", () => {
      const body = {
        messages: [
          { role: "user", content: "first" },
          { role: "assistant", content: "answer" },
          { role: "user", content: "second" },
        ],
      };
      const result = openaiToKiroRequest(
        "claude-sonnet-4.6",
        body,
        true,
        {},
        { thinkingIntent: { mode: "budget", budget: 8192 }, clientSessionId: "session-8192" },
      );

      expect(contentOf(result)).toContain("<max_thinking_length>8192</max_thinking_length>");
      expect(result.conversationState.conversationId).toBe("session-8192");
      expect(JSON.stringify(result)).not.toContain("(8192)");
      expect(Reflect.ownKeys(result).filter((key) => String(key).startsWith("_"))).toEqual([]);
    });

    it("maps reasoning_effort low to max_thinking_length 1024", () => {
      const body = {
        reasoning_effort: "low",
        messages: [{ role: "user", content: "Think lightly" }]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      expect(contentOf(result)).toContain("<max_thinking_length>1024</max_thinking_length>");
    });

    it("maps reasoning_effort high to max_thinking_length 24576", () => {
      const body = {
        reasoning_effort: "high",
        messages: [{ role: "user", content: "Think deeply" }]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      expect(contentOf(result)).toContain("<max_thinking_length>24576</max_thinking_length>");
    });

    it("clamps reasoning_effort max to Kiro max_thinking_length 32000", () => {
      const body = {
        reasoning_effort: "max",
        messages: [{ role: "user", content: "Think as much as possible" }]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      expect(contentOf(result)).toContain("<max_thinking_length>32000</max_thinking_length>");
    });

    it("clamps OpenAI Responses reasoning.effort xhigh to max_thinking_length 32000", () => {
      const body = {
        reasoning: { effort: "xhigh" },
        messages: [{ role: "user", content: "Think extra deeply" }]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      expect(contentOf(result)).toContain("<max_thinking_length>32000</max_thinking_length>");
    });

    it("uses Claude thinking.budget_tokens as max_thinking_length", () => {
      const body = {
        thinking: { type: "enabled", budget_tokens: 4096 },
        messages: [{ role: "user", content: "Use a fixed budget" }]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      expect(contentOf(result)).toContain("<max_thinking_length>4096</max_thinking_length>");
    });

    it("uses the default budget for synthetic -thinking models with no explicit config", () => {
      const body = {
        messages: [{ role: "user", content: "Think by model suffix" }]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6-thinking", body, true, {});

      expect(contentOf(result)).toContain("<max_thinking_length>16000</max_thinking_length>");
    });

    it("does not inject thinking prefix for reasoning_effort none", () => {
      const body = {
        reasoning_effort: "none",
        messages: [{ role: "user", content: "Do not think" }]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      expect(contentOf(result)).not.toContain("<thinking_mode>enabled</thinking_mode>");
      expect(contentOf(result)).not.toContain("<max_thinking_length>");
    });
  });

  // decolua/9router#2596 regression: the GPT-5.6 family registers an
  // upstreamModelId (bare wire id), so chatCore's cleanUpstreamModel has
  // already lost the synthetic -thinking/-agentic suffix before translation.
  // The chatCore Kiro seam passes the canonical (suffixed) catalog id instead
  // so resolveKiroModel recovers the flags. This pins that selector + the
  // translator's flag recovery and wire-boundary strip together.
  describe("GPT-5.6 synthetic variant seam (upstream #2596)", () => {
    it("recovers thinking+agentic flags from the canonical id and strips to the bare wire id", () => {
      const requested = "gpt-5.6-sol-thinking-agentic";
      // The real chatCore non-passthrough selector: Kiro target resolves the
      // canonical (suffixed) catalog id, not the suffix-stripped upstreamModelId.
      const translationModel = resolveKiroTranslationModel(
        FORMATS.KIRO, "kr", requested, getModelUpstreamId("kr", requested),
      );
      expect(translationModel).toBe(requested); // canonical id keeps the suffix

      const body = { messages: [{ role: "user", content: "Write a big file" }] };
      const result = openaiToKiroRequest(translationModel, body, true, {});

      // Flags recovered: thinking prefix + first-turn agentic prompt injected.
      expect(contentOf(result)).toContain("<thinking_mode>enabled</thinking_mode>");
      expect(contentOf(result)).toContain("<max_thinking_length>");
      expect(contentOf(result)).toContain("# CRITICAL: CHUNKED WRITE PROTOCOL");
      expect(contentOf(result)).toContain("Write a big file");
      // Wire boundary carries the bare upstream id, never the synthetic suffix.
      expect(modelIdOf(result)).toBe("gpt-5.6-sol");
      expect(JSON.stringify(result)).not.toContain("gpt-5.6-sol-thinking-agentic");
    });

    it("emits no stray top-level reasoning_effort through the full translate pipeline (caps thinkingFormat kiro)", () => {
      // exercises applyThinking: explicit OpenAI reasoning intent on a Kiro
      // GPT-5.6 request must become the <thinking_mode> system prefix, not a
      // top-level reasoning_effort field on the CodeWhisperer payload.
      const body = {
        reasoning_effort: "high",
        messages: [{ role: "user", content: "hi" }],
      };
      const result = translateRequest(
        FORMATS.OPENAI,
        FORMATS.KIRO,
        "gpt-5.6-sol-thinking",
        body,
        true,
        null,
        "kiro",
      );

      expect(result.reasoning_effort).toBeUndefined();
      expect(contentOf(result)).toContain("<thinking_mode>enabled</thinking_mode>");
      expect(modelIdOf(result)).toBe("gpt-5.6-sol");
    });

    it("passing the stripped upstreamModelId loses the flags (proves the seam is required)", () => {
      const stripped = getModelUpstreamId("kr", "gpt-5.6-sol-thinking");
      expect(stripped).toBe("gpt-5.6-sol"); // upstreamModelId strips the suffix

      const body = { messages: [{ role: "user", content: "hi" }] };
      const result = openaiToKiroRequest(stripped, body, true, {});

      // Without the suffix there is no model-derived thinking/agentic signal.
      expect(modelIdOf(result)).toBe("gpt-5.6-sol");
      expect(contentOf(result)).not.toContain("<thinking_mode>enabled</thinking_mode>");
    });

    it("resolveKiroTranslationModel keeps cleanUpstreamModel for non-Kiro targets", () => {
      expect(resolveKiroTranslationModel(FORMATS.CLAUDE, "kr", "gpt-5.6-sol-thinking", "gpt-5.6-sol"))
        .toBe("gpt-5.6-sol");
      expect(resolveKiroTranslationModel(FORMATS.OPENAI, "openai", "gpt-5.6-sol", "gpt-5.6-sol"))
        .toBe("gpt-5.6-sol");
    });
  });
});
