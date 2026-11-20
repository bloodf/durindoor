import { describe, expect, it } from "vitest";
import registry from "../../open-sse/providers/registry/index.js";
import minimax from "../../open-sse/providers/registry/minimax.js";
import minimaxCn from "../../open-sse/providers/registry/minimax-cn.js";

describe("MiniMax Code account integration boundary (#2034)", () => {
  it("does not register an unapproved account client or alias", () => {
    // See internal/docs/minimax-code-2034.md for the source-pinned blocker.
    expect(registry.some((entry) => entry.id === "minimax-code" || entry.alias === "mmcode")).toBe(false);
  });

  it("keeps the existing regional MiniMax routes as API-key providers", () => {
    expect(registry).toContain(minimax);
    expect(registry).toContain(minimaxCn);
    expect([minimax.category, minimaxCn.category]).toEqual(["apikey", "apikey"]);
    expect(minimax.transport.baseUrl).toBe("https://api.minimax.io/anthropic/v1/messages");
    expect(minimaxCn.transport.baseUrl).toBe("https://api.minimax.cn/anthropic/v1/messages");
    expect(minimax.transport.auth.header).toBe("x-api-key");
    expect(minimaxCn.transport.auth.header).toBe("x-api-key");
  });
});
