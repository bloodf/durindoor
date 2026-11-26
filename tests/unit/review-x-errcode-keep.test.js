import { describe, expect, it, vi } from "vitest";

const credentials = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentialsWithQuotaPreflight: credentials.select,
  projectProviderCredentials: vi.fn(),
}));
vi.mock("@/lib/webhooks/index.js", () => ({ notifyWebhookEvent: vi.fn() }));

import { selectCredentials } from "@/sse/handlers/chat/singleModel/credentials.js";

describe("unavailable account error codes", () => {
  it.each([
    [429, "rate_limit_exceeded"],
    [503, "upstream_code"],
  ])("returns the appropriate code for status %i", async (status, expectedCode) => {
    credentials.select.mockResolvedValue({ allRateLimited: true, lastErrorCode: status, lastError: "Unavailable" });
    const result = await selectCredentials({ provider: "openai", model: "test" }, {
      excludeConnectionIds: new Set(["failed"]), attemptedBlockers: [], lastErrorCode: "upstream_code", lastStatus: status,
    });
    expect(result.response.status).toBe(status);
    expect((await result.response.json()).error.code).toBe(expectedCode);
  });
});
