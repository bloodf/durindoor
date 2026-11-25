import { describe, expect, it } from "vitest";
import { anchorClaudeCache, normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";

describe("trailing system cache marker carry-over", () => {
  for (const content of ["followup", [{ type: "text", text: "followup" }]]) {
    it(`preserves a one-hour marker for ${Array.isArray(content) ? "array" : "string"} user content`, () => {
      const body = { messages: [
        { role: "user", content: structuredClone(content) },
        { role: "system", content: [{ type: "text", text: "instruction", cache_control: { type: "ephemeral", ttl: "1h" } }] },
      ] };
      normalizeClaudePassthrough(body, "", "claude", null, { foldSystemTurns: true });
      anchorClaudeCache(body);
      expect(body.messages).toEqual([{ role: "user", content: [
        { type: "text", text: "followup", cache_control: { type: "ephemeral", ttl: "1h" } },
      ] }]);
    });
  }
});
