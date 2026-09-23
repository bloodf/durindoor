// Port of OmniRoute's manual "Clear cooldown" action (#12224): the persisted
// 429 bench (providerConnections.rateLimitedUntil) is DurinDoor's own lesson,
// not upstream truth. PUT /api/providers/[id] now accepts `rateLimitedUntil:
// null` to lift it immediately (and resets backoffLevel), while an attempt to
// set any other value is rejected — this endpoint clears a cooldown, it does
// not let a caller impose one.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getProviderConnectionById = vi.hoisted(() => vi.fn());
const updateProviderConnection = vi.hoisted(() => vi.fn());

vi.mock("@/models", () => ({
  getProviderConnectionById,
  updateProviderConnection,
  getProxyPoolById: vi.fn(),
  deleteProviderConnection: vi.fn()
}));
vi.mock("@/shared/services/quotaAutoPing", () => ({
  notifyQuotaAutoPingSettingChanged: vi.fn()
}));

import { PUT } from "../../src/app/api/providers/[id]/route.js";

function makeConnection(overrides = {}) {
  return {
    id: "conn-1",
    provider: "z-ai",
    authType: "apikey",
    name: "main",
    isActive: true,
    rateLimitedUntil: new Date(Date.now() + 60_000).toISOString(),
    backoffLevel: 3,
    ...overrides
  };
}

function putRequest(body) {
  return new Request("http://localhost/api/providers/conn-1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function params(id = "conn-1") {
  return Promise.resolve({ id });
}

describe("PUT /api/providers/[id] clear-cooldown (port #12224)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears rateLimitedUntil and resets backoffLevel on rateLimitedUntil: null", async () => {
    const connection = makeConnection();
    getProviderConnectionById.mockResolvedValue(connection);
    updateProviderConnection.mockImplementation(async (id, data) => ({ ...connection, ...data }));

    const response = await PUT(putRequest({ rateLimitedUntil: null }), { params: params() });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateProviderConnection).toHaveBeenCalledTimes(1);
    expect(updateProviderConnection.mock.calls[0][1]).toMatchObject({
      rateLimitedUntil: null,
      backoffLevel: 0
    });
    expect(body.connection.rateLimitedUntil).toBeNull();
  });

  it("rejects an attempt to set a future rateLimitedUntil through this endpoint", async () => {
    const response = await PUT(
      putRequest({ rateLimitedUntil: new Date(Date.now() + 600_000).toISOString() }),
      { params: params() }
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/only be cleared/i);
    expect(getProviderConnectionById).not.toHaveBeenCalled();
    expect(updateProviderConnection).not.toHaveBeenCalled();
  });

  it("leaves rateLimitedUntil untouched when the field is omitted", async () => {
    const connection = makeConnection();
    getProviderConnectionById.mockResolvedValue(connection);
    updateProviderConnection.mockImplementation(async (id, data) => ({ ...connection, ...data }));

    await PUT(putRequest({ name: "renamed" }), { params: params() });

    expect(updateProviderConnection.mock.calls[0][1]).not.toHaveProperty("rateLimitedUntil");
    expect(updateProviderConnection.mock.calls[0][1]).not.toHaveProperty("backoffLevel");
  });
});
