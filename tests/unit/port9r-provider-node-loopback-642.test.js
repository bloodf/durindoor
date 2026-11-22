import { describe, expect, it, vi } from "vitest";

vi.mock("open-sse/utils/outboundUrlGuard.js", () => ({
  OutboundUrlGuardError: class extends Error {},
  guardedProbeFetch: vi.fn(),
}));

import { guardedProbeFetch } from "open-sse/utils/outboundUrlGuard.js";
import { POST } from "../../src/app/api/provider-nodes/validate/route.js";

describe("provider node connection guidance", () => {
  it.each([["http://localhost:11434", "ECONNREFUSED"], ["http://127.0.0.1:11434", "ETIMEDOUT"]])("explains container loopback for %s", async (baseUrl, code) => {
    vi.mocked(guardedProbeFetch).mockRejectedValueOnce(new TypeError("fetch failed", { cause: { code } }));
    const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ baseUrl, type: "openai-compatible" }) }));
    expect((await response.json()).error).toContain("In Docker, localhost refers to the container");
  });

  it("does not mistake a hostname beginning with localhost for loopback", async () => {
    vi.mocked(guardedProbeFetch).mockRejectedValueOnce(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }));
    const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ baseUrl: "http://localhost.example", type: "openai-compatible" }) }));
    expect((await response.json()).error).toBe("Connection refused - provider node offline or unreachable");
  });
});
