import { describe, expect, it } from "vitest";

import { estimateTokens } from "../../open-sse/handlers/countTokensCore.js";

describe("Anthropic count_tokens estimator", () => {
  it("preserves the existing plain text estimate", () => {
    const result = estimateTokens({
      messages: [
        {
          role: "user",
          content: "hello world",
        },
      ],
    });

    expect(result).toBe(3);
  });

  it("counts tool and thinking content blocks that carry context", () => {
    const result = estimateTokens({
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_01",
              name: "Read",
              input: { file_path: "/tmp/example.txt" },
            },
            {
              type: "thinking",
              thinking: "Need to inspect the file before answering.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_01",
              content: "line1 line2 line3 some file content here",
            },
          ],
        },
      ],
    });

    expect(result).toBeGreaterThan(0);
  });

  it("counts system prompts and tool definitions", () => {
    const result = estimateTokens({
      system: "You are a coding assistant.",
      tools: [
        {
          name: "Read",
          description: "Read a file",
          input_schema: {
            type: "object",
            properties: {
              file_path: { type: "string" },
            },
          },
        },
      ],
      messages: [],
    });

    expect(result).toBeGreaterThan(0);
  });
});
