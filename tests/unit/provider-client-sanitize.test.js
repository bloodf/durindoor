import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  },
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
}));

vi.mock("@/lib/oauth/providers", () => ({
  backfillCodexEmails: vi.fn(),
}));

vi.mock("@/lib/oauth/services/cursorLocalStore.js", () => ({
  backfillCursorEmails: vi.fn(),
}));

const { sanitizeProviderConnectionForClient } = await import("../../src/app/api/providers/client/route.js");

describe("/api/providers/client sanitization", () => {
  it("preserves Google PSE cx for edit forms while stripping unsafe provider data", () => {
    const sanitized = sanitizeProviderConnectionForClient({
      id: "conn-1",
      provider: "google-pse",
      authType: "apikey",
      name: "Google PSE",
      apiKey: "secret-key",
      providerSpecificData: {
        cx: "search-engine-1",
        proxyPoolId: "pool-1",
        apiKey: "nested-secret",
      },
    });

    expect(sanitized.apiKey).toBeUndefined();
    expect(sanitized.providerSpecificData).toEqual({
      cx: "search-engine-1",
      proxyPoolId: "pool-1",
    });
  });
});
