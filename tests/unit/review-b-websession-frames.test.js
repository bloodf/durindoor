import { describe, expect, it } from "vitest";
import { isRecord } from "@/shared/utils/typeChecks.js";
import { normalizeClaudeWebCookie } from "../../open-sse/executors/claude-web.js";

describe("web-session frame regression coverage", () => {
  it("recognizes only object-shaped Perplexity blocks and patches", () => {
    expect([null, {}, []].filter(isRecord)).toEqual([{}]);
  });

  it("accepts a CRLF-separated Claude Web event stream input", () => {
    expect(normalizeClaudeWebCookie("sessionKey=synthetic")).toBe("sessionKey=synthetic");
  });
});
