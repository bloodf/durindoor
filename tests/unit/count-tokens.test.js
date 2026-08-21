import { describe, expect, it } from "vitest";

import { POST, OPTIONS } from "../../src/app/api/v1/messages/count_tokens/route.js";
import { estimateTokens } from "../../open-sse/handlers/countTokensCore.js";

/** Pins count_tokens route edge contracts added upstream in decolua/9router#2959. */
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

  it("handles OPTIONS CORS preflight requests", async () => {
    const response = await OPTIONS();

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
  });

  it("returns the current error envelope for malformed JSON", async () => {
    const response = await POST(new Request("https://durindoor.test/v1/messages/count_tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ invalid json ...",
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        message: "Invalid JSON body",
        type: "invalid_request_error",
        code: "bad_request",
      },
    });
  });

  it("uses the minimum estimate for empty or null payloads", () => {
    expect(estimateTokens({})).toBe(1);
    expect(estimateTokens(null)).toBe(1);
  });
});
