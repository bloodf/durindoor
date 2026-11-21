import { describe, expect, it, vi } from "vitest";
import TinyCmsExecutor from "../../open-sse/executors/tinycms-web.js";
import provider from "../../open-sse/providers/private/tinycms-web.js";

describe("TinyCMS Web staged provider", () => {
  it("exposes the pinned catalog and UUID credential contract", () => {
    expect(provider.transport.executor).toBe("tinycms-web");
    expect(provider.models.length).toBeGreaterThan(10);
    expect(provider.authHint).toContain("app-config-uuid");
  });
  it("rejects invalid UUIDs and fetches a challenge for valid synthetic UUIDs", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ challengeId: "synthetic", challenge: "challenge", expiresAt: 1, version: "1", difficulty: 0 }), { headers: { "content-type": "application/json" } }));
    const executor = new TinyCmsExecutor({ fetcher });
    expect((await executor.execute({ credentials: { apiKey: "bad" }, body: {} })).response.status).toBe(401);
    expect((await executor.execute({ credentials: { apiKey: "Rsynthetic" }, body: {} })).response.status).toBe(503);
    expect(fetcher).toHaveBeenCalledWith("https://gov.freegpt.win/api/challenge", expect.any(Object));
  });
});
