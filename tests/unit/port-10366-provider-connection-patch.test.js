import { describe, it, expect, vi } from "vitest";

// Mock the heavy model layer so importing the route doesn't touch real DB.
vi.mock("@/models", () => ({
  getProviderConnectionById: vi.fn(),
  getProxyPoolById: vi.fn(),
  updateProviderConnection: vi.fn(),
  deleteProviderConnection: vi.fn(),
}));
vi.mock("@/lib/providerAccountIds", () => ({
  requiresProviderAccountId: vi.fn(),
}));
vi.mock("@/lib/db/helpers/mergeProviderMetadata.js", () => ({
  mergeProviderSpecificData: vi.fn(),
}));
vi.mock("@/lib/oauth/proxySelection.js", () => ({
  buildOAuthProxyMetadataPatch: vi.fn(),
}));
vi.mock("open-sse/executors/default.js", () => ({
  normalizeAccountIdPlaceholder: vi.fn(),
}));
vi.mock("@/shared/services/quotaAutoPing", () => ({
  notifyQuotaAutoPingSettingChanged: vi.fn(),
}));
vi.mock("@/lib/providerNormalization", () => ({
  normalizeProviderSpecificData: vi.fn(),
}));

const route = await import("../../src/app/api/providers/[id]/route.js");

describe("port: omni #10366 - PATCH /api/providers/[id] delegates to PUT", () => {
  it("exports a PATCH handler function", () => {
    expect(typeof route.PATCH).toBe("function");
  });

  it("PATCH delegates to PUT (identical status for identical input)", async () => {
    const ctx = { params: Promise.resolve({ id: "missing-conn-id" }) };
    const body = JSON.stringify({ name: "rotated" });

    // Fresh Request per call: `request.json()` consumes the body stream.
    const putRes = await route.PUT(new Request("http://x/api/providers/x", { method: "PUT", body, headers: { "content-type": "application/json" } }), ctx);
    const patchRes = await route.PATCH(new Request("http://x/api/providers/x", { method: "PATCH", body, headers: { "content-type": "application/json" } }), ctx);

    expect(patchRes.status).toBe(putRes.status);
  });
});
