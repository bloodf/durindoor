import { describe, it, expect, beforeAll } from "vitest";
import "./registerAll.js";
import { normalizeClaudeToolName } from "../../open-sse/services/claudeCodeToolRemapper.js";
import { restoreOpenAIToolNames } from "../../open-sse/translator/concerns/toolCall.js";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";
import { geminiToClaudeResponse } from "../../open-sse/translator/response/gemini-to-claude.js";

beforeAll(() => {
  // ensure translator registry populated
});

describe("port(omniroute): #10392 - normalize Claude tool call names to PascalCase", () => {
  describe("normalizeClaudeToolName direct map", () => {
    it("maps lowercase built-in names to PascalCase", () => {
      expect(normalizeClaudeToolName("bash", undefined)).toBe("Bash");
      expect(normalizeClaudeToolName("read", undefined)).toBe("Read");
      expect(normalizeClaudeToolName("edit", undefined)).toBe("Edit");
      expect(normalizeClaudeToolName("write", undefined)).toBe("Write");
      expect(normalizeClaudeToolName("websearch", undefined)).toBe("WebSearch");
      expect(normalizeClaudeToolName("webfetch", undefined)).toBe("WebFetch");
      expect(normalizeClaudeToolName("agent", undefined)).toBe("Agent");
    });

    it("passes through already-cased names", () => {
      expect(normalizeClaudeToolName("Bash", undefined)).toBe("Bash");
      expect(normalizeClaudeToolName("Read", undefined)).toBe("Read");
      expect(normalizeClaudeToolName("CustomTool", undefined)).toBe("CustomTool");
    });

    it("passes through unknown lowercase names", () => {
      expect(normalizeClaudeToolName("unknown", undefined)).toBe("unknown");
      expect(normalizeClaudeToolName("my_custom_tool", undefined)).toBe("my_custom_tool");
    });

    it("returns empty/non-string input unchanged", () => {
      expect(normalizeClaudeToolName("", undefined)).toBe("");
      expect(normalizeClaudeToolName(null, undefined)).toBe(null);
      expect(normalizeClaudeToolName(undefined, undefined)).toBe(undefined);
      expect(normalizeClaudeToolName(42, undefined)).toBe(42);
    });
  });

  describe("normalizeClaudeToolName respects toolNameMap override", () => {
    it("uses toolNameMap alias when provided (exact case wins)", () => {
      const toolNameMap = new Map([
        ["custom_read", "CustomRead"],
        ["custom_bash", "CustomBash"],
      ]);
      expect(normalizeClaudeToolName("custom_read", toolNameMap)).toBe("CustomRead");
      expect(normalizeClaudeToolName("custom_bash", toolNameMap)).toBe("CustomBash");
    });

    it("falls back to built-in case map when alias missing", () => {
      const toolNameMap = new Map([["custom_read", "CustomRead"]]);
      expect(normalizeClaudeToolName("bash", toolNameMap)).toBe("Bash");
    });

    it("toolNameMap alias takes priority over built-in case map", () => {
      const toolNameMap = new Map([["bash", "Shell"]]);
      expect(normalizeClaudeToolName("bash", toolNameMap)).toBe("Shell");
    });
  });

  describe("openai-to-claude response translation", () => {
    it("normalizes lowercase tool name through the proxy_ prefix path", () => {
      const state = { toolCalls: new Map(), nextBlockIndex: 0, toolNameMap: null };
      const chunk = {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        created: 1,
        model: "gpt-x",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: "call_1", type: "function", function: { name: "proxy_bash", arguments: "{}" } },
              ],
            },
          },
        ],
      };
      const out = openaiToClaudeResponse(chunk, state);
      // The first emitted event is content_block_start with the tool name; find it.
      const start = (out || []).find((e) => e?.type === "content_block_start");
      expect(start).toBeTruthy();
      expect(start.content_block.type).toBe("tool_use");
      expect(start.content_block.name).toBe("Bash");
    });

    it("preserves already-cased tool names", () => {
      const state = { toolCalls: new Map(), nextBlockIndex: 0, toolNameMap: null };
      const chunk = {
        id: "chatcmpl-2",
        object: "chat.completion.chunk",
        created: 1,
        model: "gpt-x",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: "call_1", type: "function", function: { name: "Read", arguments: "{}" } },
              ],
            },
          },
        ],
      };
      const out = openaiToClaudeResponse(chunk, state);
      const start = (out || []).find((e) => e?.type === "content_block_start");
      expect(start.content_block.name).toBe("Read");
    });
  });

  describe("gemini-to-claude response translation", () => {
    it("normalizes lowercase tool name from Gemini parts", () => {
      const state = { toolNameMap: null };
      const chunk = {
        responseId: "r1",
        modelVersion: "gemini-x",
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { id: "fc1", name: "read", args: { file: "/x" } } },
              ],
            },
          },
        ],
      };
      const out = geminiToClaudeResponse(chunk, state);
      const start = (out || []).find((e) => e?.type === "content_block_start");
      expect(start).toBeTruthy();
      expect(start.content_block.type).toBe("tool_use");
      expect(start.content_block.name).toBe("Read");
    });

    it("preserves already-cased tool names", () => {
      const state = { toolNameMap: null };
      const chunk = {
        responseId: "r2",
        modelVersion: "gemini-x",
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { id: "fc1", name: "Bash", args: { cmd: "ls" } } },
              ],
            },
          },
        ],
      };
      const out = geminiToClaudeResponse(chunk, state);
      const start = (out || []).find((e) => e?.type === "content_block_start");
      expect(start.content_block.name).toBe("Bash");
    });
  });

  describe("restoreOpenAIToolNames centralization", () => {
    it("normalizes a content_block_start tool_use name to PascalCase", () => {
      const parsed = {
        type: "content_block_start",
        content_block: { type: "tool_use", id: "t1", name: "write", input: {} },
      };
      const changed = restoreOpenAIToolNames(parsed, null);
      expect(changed).toBe(true);
      expect(parsed.content_block.name).toBe("Write");
    });

    it("passes through an already-cased tool_use name", () => {
      const parsed = {
        type: "content_block_start",
        content_block: { type: "tool_use", id: "t1", name: "Read", input: {} },
      };
      const changed = restoreOpenAIToolNames(parsed, null);
      expect(changed).toBe(false);
      expect(parsed.content_block.name).toBe("Read");
    });

    it("ignores non-tool_use content blocks", () => {
      const parsed = {
        type: "content_block_start",
        content_block: { type: "text", text: "" },
      };
      const changed = restoreOpenAIToolNames(parsed, null);
      expect(changed).toBe(false);
    });

    it("decloaks a known alias when aliases Map provided", () => {
      const aliases = new Map([["Execute_ide", "execute_ide"]]);
      const parsed = {
        type: "content_block_start",
        content_block: { type: "tool_use", id: "t1", name: "Execute_ide", input: {} },
      };
      const changed = restoreOpenAIToolNames(parsed, aliases);
      expect(changed).toBe(true);
      expect(parsed.content_block.name).toBe("execute_ide");
    });
  });
});
