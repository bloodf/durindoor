// A Codex 404 for a missing model must not cool down the account's other models.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connection: null }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => [mocks.connection]),
  getProviderConnectionById: vi.fn(async () => mocks.connection),
  updateProviderConnection: vi.fn(async (_id, patch) => Object.assign(mocks.connection, patch)),
  getSettings: vi.fn(async () => ({})),
  getProxyPools: vi.fn(async () => []),
  getQuotaFetchState: vi.fn(async () => null),
  getQuotaReservationPressure: vi.fn(async () => new Map()),
  validateApiKey: vi.fn(),
}));

const { markAccountUnavailable, getProviderCredentials } = await import("../../src/sse/services/auth.js");

// Wording that matches none of the permanent wrong-model text rules.
const MISSING = JSON.stringify({ error: { code: "model_not_found", message: "The requested resource is unavailable" } });
const sibling = () => getProviderCredentials("codex", null, "gpt-5.5", { quotaSnapshotsLoader: async () => [] });

describe("Codex model_not_found scope (OmniRoute #20683)", () => {
  beforeEach(() => {
    mocks.connection = { id: "one", provider: "codex", authType: "oauth", accessToken: "synthetic", priority: 1, isActive: true };
  });

  it.each(["gpt-9-missing", "codex", "spark"])("serves a sibling model after a 404 for %s", async (model) => {
    const outcome = await markAccountUnavailable("one", 404, MISSING, "codex", model);

    expect(outcome.shouldFallback).toBe(false);
    expect(Object.keys(mocks.connection).filter((key) => key.startsWith("modelLock_"))).toEqual([]);
    expect((await sibling())?.connectionId).toBe("one");
  });

  it("reads the code from the structured error body", async () => {
    const outcome = await markAccountUnavailable("one", 404, "The requested resource is unavailable", "codex", "gpt-9-missing", null, {
      errorBody: { error: { code: "model_not_found" } },
    });

    expect(outcome.shouldFallback).toBe(false);
    expect((await sibling())?.connectionId).toBe("one");
  });

  it("still locks a catalog model alone", async () => {
    await markAccountUnavailable("one", 404, MISSING, "codex", "gpt-6-sol");

    expect(Object.keys(mocks.connection).filter((key) => key.startsWith("modelLock_"))).toEqual(["modelLock_gpt-6-sol"]);
    expect((await sibling())?.connectionId).toBe("one");
  });
});
