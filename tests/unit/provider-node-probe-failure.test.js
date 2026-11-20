import { describe, expect, it, vi } from "vitest";

vi.mock("open-sse/utils/outboundUrlGuard.js", () => ({
  OutboundUrlGuardError: class extends Error {},
  guardedProbeFetch: vi.fn(),
}));

import { guardedProbeFetch } from "open-sse/utils/outboundUrlGuard.js";
import { POST } from "../../src/app/api/provider-nodes/validate/route.js";

describe("provider node probe failures", () => {
  it.each([[new TypeError("fetch failed"), 200], [new Error("bug"), 500]])("reports probe errors without hiding bugs", async (error, status) => {
    vi.mocked(guardedProbeFetch).mockRejectedValueOnce(error);
    const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ baseUrl: "https://example.com/v1", type: "openai-compatible" }) }));
    expect(response.status).toBe(status);
    expect((await response.json()).valid).toBe(false);
  });
});
