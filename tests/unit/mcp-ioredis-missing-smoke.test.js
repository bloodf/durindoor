// MCP-03: missing optional dependency must not crash embedded MCP route.
// OmniRoute #6559 fixed a startup crash when ioredis was absent because its
// rateLimiter imported it at module load. DurinDoor has no ioredis/rateLimiter
// equivalent, but this smoke test ensures the embedded MCP gateway message
// route can be imported without ioredis installed.

import { describe, it, expect } from "vitest";

describe("MCP gateway import without ioredis", () => {
  it("message route imports and exposes a POST handler", async () => {
    const route = await import("../../src/app/api/mcp-gateway/message/route.js");
    expect(typeof route).toBe("object");
    expect(typeof route.POST).toBe("function");
  });
});
