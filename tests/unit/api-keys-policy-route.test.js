import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createApiKey: vi.fn(),
  getApiKeys: vi.fn(),
  getApiKeyById: vi.fn(),
  updateApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "content-type": "application/json" },
      });
    },
  },
}));

vi.mock("@/lib/localDb", () => ({
  createApiKey: mocks.createApiKey,
  getApiKeys: mocks.getApiKeys,
  getApiKeyById: mocks.getApiKeyById,
  updateApiKey: mocks.updateApiKey,
  deleteApiKey: mocks.deleteApiKey,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

import { POST } from "@/app/api/keys/route.js";
import { PUT } from "@/app/api/keys/[id]/route.js";

describe("API-key policy routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConsistentMachineId.mockResolvedValue("machine-route");
  });

  it("creates an API key with policy and expiry metadata", async () => {
    const policy = { maxTokens: 5000 };
    const expiresAt = "2030-01-01T00:00:00.000Z";
    mocks.createApiKey.mockResolvedValue({
      id: "key-route",
      key: "sk-12345678",
      name: "route-key",
      machineId: "machine-route",
      allowedCombos: [],
      dailyLimitTokens: null,
      policy,
      expiresAt,
    });

    const response = await POST(new Request("http://localhost/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "route-key", policy, expiresAt }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.createApiKey).toHaveBeenCalledWith(
      "route-key",
      "machine-route",
      [],
      undefined,
      { policy, expiresAt },
    );
    expect(await response.json()).toMatchObject({ policy, expiresAt });
  });

  it("updates API-key policy and expiry metadata without changing the secret", async () => {
    const policy = { maxCostUsd: 2.5 };
    const expiresAt = "2032-01-01T00:00:00.000Z";
    mocks.getApiKeyById.mockResolvedValue({ id: "key-route", key: "sk-12345678" });
    mocks.updateApiKey.mockResolvedValue({
      id: "key-route",
      key: "sk-12345678",
      policy,
      expiresAt,
    });

    const response = await PUT(new Request("http://localhost/api/keys/key-route", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ policy, expiresAt }),
    }), { params: Promise.resolve({ id: "key-route" }) });

    expect(mocks.updateApiKey).toHaveBeenCalledWith("key-route", { policy, expiresAt });
    expect(await response.json()).toEqual({
      key: { id: "key-route", key: "sk-12345678", policy, expiresAt },
    });
  });
});
