import { describe, expect, it } from "vitest";

import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// A combo hands each leg a shallow copy of the client body, so content blocks are shared.
const clientBody = () => ({
  model: "claude-sonnet-4-5",
  max_tokens: 64,
  system: [{ type: "text", text: "S" }],
  messages: [
    { role: "user", content: [{ type: "text", text: "q1", cache_control: { type: "ephemeral" } }] },
    { role: "assistant", content: [{ type: "thinking", thinking: "t", signature: "sig-123" }, { type: "text", text: "a1" }] },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: [{ type: "text", text: "out", cache_control: { type: "ephemeral" } }],
        },
        { type: "text", text: "q2" },
      ],
    },
  ],
});

describe("OmniRoute #20196 - Claude request preparation leaves the client blocks alone", () => {
  for (const provider of ["claude", "anthropic-compatible-test", "minimax"]) {
    it(`does not edit the caller's body for ${provider}`, () => {
      const original = clientBody();
      const before = JSON.stringify(original);

      translateRequest(FORMATS.CLAUDE, FORMATS.CLAUDE, "claude-sonnet-4-5", { ...original }, false, {}, provider);

      expect(JSON.stringify(original)).toBe(before);
    });
  }
});
