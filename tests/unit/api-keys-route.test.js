import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createApiKey: vi.fn(),
  getApiKeys: vi.fn(),
  getConsistentMachineId: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeys: mocks.getApiKeys,
  createApiKey: mocks.createApiKey,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

function request(body) {
  return new Request("https://9router.local/api/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function json(response) {
  return await response.json();
}

describe("API keys route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConsistentMachineId.mockResolvedValue("machine-abc");
    mocks.createApiKey.mockImplementation(async (name, machineId, allowedCombos, dailyLimitTokens, expiresAt) => {
      if (expiresAt) {
        const time = new Date(expiresAt).getTime();
        if (!Number.isFinite(time)) throw new Error("expiresAt must be a parseable future timestamp");
        if (time <= Date.now()) throw new Error("expiresAt must be in the future");
      }
      return {
        id: "key-id",
        key: "sk-machine-abc-key001-crc12345",
        name,
        machineId,
        allowedCombos: allowedCombos || [],
        dailyLimitTokens: dailyLimitTokens ?? null,
        expiresAt: expiresAt ?? null,
      };
    });
  });

  it("creates non-expiring API key by default", async () => {
    const { POST } = await import("@/app/api/keys/route.js");

    const response = await POST(request({ name: " prod " }));
    const body = await json(response);

    expect(response.status).toBe(201);
    expect(body.expiresAt).toBeNull();
    expect(mocks.createApiKey).toHaveBeenCalledWith("prod", "machine-abc", [], undefined, undefined);
  });

  it("rejects blank name", async () => {
    const { POST } = await import("@/app/api/keys/route.js");

    const response = await POST(request({ name: "   " }));

    expect(response.status).toBe(400);
    expect(mocks.createApiKey).not.toHaveBeenCalled();
  });

  it("normalizes future expiresAt and returns it", async () => {
    const { POST } = await import("@/app/api/keys/route.js");
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    const response = await POST(request({ name: "test", expiresAt }));
    const body = await json(response);

    expect(response.status).toBe(201);
    expect(body.expiresAt).toBe(expiresAt);
  });

  it("returns 400 for invalid expiresAt", async () => {
    const { POST } = await import("@/app/api/keys/route.js");

    const response = await POST(request({ name: "test", expiresAt: "not-a-date" }));

    expect(response.status).toBe(400);
  });
});
