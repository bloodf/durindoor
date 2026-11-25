import { describe, expect, it, vi } from "vitest";
import { performance } from "node:perf_hooks";
import { sanitizeCodeBuddyMessages } from "../../open-sse/executors/codebuddy-protocol.js";

describe("CodeBuddy identity sanitization", () => {
  it("handles a long adversarial line quickly, including after an identity match", () => {
    const line = "anthropic official ".repeat(2700);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const start = performance.now();
      const result = sanitizeCodeBuddyMessages("codebuddy", [{ role: "system", content: `You are Claude Code\n${line}` }]);
      expect(performance.now() - start).toBeLessThan(100);
      expect(result[0].content).toContain("helpful AI assistant");
      expect(result[0].content).toContain(line);
    } finally {
      warn.mockRestore();
    }
  });

  it.each(["Claude Code is the official CLI", "Anthropic provides the official CLI", "You are a coding agent"]) (
    "neutralizes %s", (phrase) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const result = sanitizeCodeBuddyMessages("codebuddy", [{ role: "system", content: phrase }]);
        expect(result[0].content).toContain("helpful AI assistant");
      } finally {
        warn.mockRestore();
      }
    },
  );
});
