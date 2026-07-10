import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeApiKeyExpiresAt } from "../../src/shared/utils/apiKeyExpiry.js";

const mocks = vi.hoisted(() => ({
  createApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  getApiKeyById: vi.fn(),
  getApiKeys: vi.fn(),
  getConsistentMachineId: vi.fn(),
  updateApiKey: vi.fn(),
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
  createApiKey: mocks.createApiKey,
  deleteApiKey: mocks.deleteApiKey,
  getApiKeyById: mocks.getApiKeyById,
  getApiKeys: mocks.getApiKeys,
  updateApiKey: mocks.updateApiKey,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

const storedKey = {
  id: "key-id",
  key: "sk-machine-abc-key001-crc12345",
  name: "Production",
  machineId: "machine-abc",
  isActive: true,
  allowedCombos: ["combo-a"],
  dailyLimitTokens: 1_000,
  policy: { allowedModels: ["openai/gpt-test"] },
  expiresAt: "2999-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function postRequest(body) {
  return new Request("https://durindoor.local/api/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function putRequest(body) {
  return new Request("https://durindoor.local/api/keys/key-id", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function json(response) {
  return await response.json();
}

describe("API keys routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConsistentMachineId.mockResolvedValue("machine-abc");
    mocks.getApiKeys.mockResolvedValue([{ ...storedKey }]);
    mocks.getApiKeyById.mockResolvedValue({ ...storedKey });
    mocks.createApiKey.mockImplementation(async (name, machineId, allowedCombos, dailyLimitTokens, expiresAt) => ({
      ...storedKey,
      name,
      machineId,
      allowedCombos,
      dailyLimitTokens: dailyLimitTokens ?? null,
      expiresAt: expiresAt === undefined ? null : normalizeApiKeyExpiresAt(expiresAt),
    }));
    mocks.updateApiKey.mockImplementation(async (_id, changes) => ({
      ...storedKey,
      ...changes,
      expiresAt: Object.hasOwn(changes, "expiresAt")
        ? normalizeApiKeyExpiresAt(changes.expiresAt)
        : storedKey.expiresAt,
    }));
  });

  it("returns stored secrets only from the one-time creation response", async () => {
    const collection = await import("@/app/api/keys/route.js");
    const detail = await import("@/app/api/keys/[id]/route.js");

    const listBody = await json(await collection.GET());
    const detailBody = await json(await detail.GET(new Request("https://durindoor.local"), {
      params: Promise.resolve({ id: storedKey.id }),
    }));
    const createBody = await json(await collection.POST(postRequest({ name: " copy once " })));

    expect(listBody.keys[0]).not.toHaveProperty("key");
    expect(detailBody.key).not.toHaveProperty("key");
    expect(listBody.keys[0].maskedKey).toBe("sk-••••••••");
    expect(detailBody.key.maskedKey).toBe(listBody.keys[0].maskedKey);
    expect(createBody.key).toBe(storedKey.key);
    expect(mocks.createApiKey).toHaveBeenCalledWith("copy once", "machine-abc", [], undefined, undefined);
  });

  it("creates a non-expiring key by default and canonicalizes a future offset", async () => {
    const { POST } = await import("@/app/api/keys/route.js");

    const never = await POST(postRequest({ name: "never" }));
    expect(never.status).toBe(201);
    expect((await json(never)).expiresAt).toBeNull();

    const expiring = await POST(postRequest({
      name: "offset",
      expiresAt: "2999-01-01T03:30:00+03:30",
    }));
    expect(expiring.status).toBe(201);
    expect((await json(expiring)).expiresAt).toBe("2999-01-01T00:00:00.000Z");
  });

  it.each([
    [{ name: "   " }, "Name is required"],
    [{ name: 42 }, "Name is required"],
    [{ name: "bad", expiresAt: "not-a-date" }, "absolute ISO-8601"],
    [{ name: "bad", expiresAt: "2999-01-01T00:00:00" }, "absolute ISO-8601"],
    [{ name: "bad", expiresAt: "" }, "absolute ISO-8601"],
    [{ name: "bad", expiresAt: 42 }, "absolute ISO-8601"],
    [{ name: "past", expiresAt: "2000-01-01T00:00:00.000Z" }, "future"],
  ])("returns a sanitized 400 for invalid POST input %#", async (body, message) => {
    const { POST } = await import("@/app/api/keys/route.js");
    const response = await POST(postRequest(body));

    expect(response.status).toBe(400);
    expect((await json(response)).error).toContain(message);
  });

  it("keeps unexpected POST failures at a sanitized 500", async () => {
    const { POST } = await import("@/app/api/keys/route.js");
    mocks.createApiKey.mockRejectedValueOnce(new Error("database path and secret detail"));

    const response = await POST(postRequest({ name: "valid" }));

    expect(response.status).toBe(500);
    expect(await json(response)).toEqual({ error: "Failed to create key" });
  });

  it("trims PUT names, leaves omitted expiry unchanged, and never returns the secret", async () => {
    const { PUT } = await import("@/app/api/keys/[id]/route.js");
    const response = await PUT(putRequest({ name: " renamed ", isActive: false }), {
      params: Promise.resolve({ id: storedKey.id }),
    });
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(mocks.updateApiKey).toHaveBeenCalledWith(storedKey.id, { name: "renamed", isActive: false });
    expect(body.key.expiresAt).toBe(storedKey.expiresAt);
    expect(body.key).not.toHaveProperty("key");
    expect(body.key.maskedKey).toBeTruthy();
  });

  it("sets and explicitly clears expiry with PUT", async () => {
    const { PUT } = await import("@/app/api/keys/[id]/route.js");

    const setResponse = await PUT(putRequest({ expiresAt: "2999-01-01T03:00:00+03:00" }), {
      params: Promise.resolve({ id: storedKey.id }),
    });
    expect((await json(setResponse)).key.expiresAt).toBe("2999-01-01T00:00:00.000Z");

    const clearResponse = await PUT(putRequest({ expiresAt: null }), {
      params: Promise.resolve({ id: storedKey.id }),
    });
    expect((await json(clearResponse)).key.expiresAt).toBeNull();
    expect(mocks.updateApiKey).toHaveBeenLastCalledWith(storedKey.id, { expiresAt: null });
  });

  it.each(["", "2030-01-01", "2030-01-01T00:00:00", 12, false, "2000-01-01T00:00:00Z"])(
    "returns 400 for invalid PUT expiry %j",
    async (expiresAt) => {
      const { PUT } = await import("@/app/api/keys/[id]/route.js");
      const response = await PUT(putRequest({ expiresAt }), {
        params: Promise.resolve({ id: storedKey.id }),
      });
      expect(response.status).toBe(400);
    },
  );

  it("returns 400 for a blank PUT name and 404 for a missing key", async () => {
    const { PUT } = await import("@/app/api/keys/[id]/route.js");
    expect((await PUT(putRequest({ name: " " }), {
      params: Promise.resolve({ id: storedKey.id }),
    })).status).toBe(400);

    mocks.getApiKeyById.mockResolvedValueOnce(null);
    expect((await PUT(putRequest({ expiresAt: null }), {
      params: Promise.resolve({ id: "missing" }),
    })).status).toBe(404);
  });

  it("keeps unexpected PUT failures at a sanitized 500", async () => {
    const { PUT } = await import("@/app/api/keys/[id]/route.js");
    mocks.updateApiKey.mockRejectedValueOnce(new Error("database path and secret detail"));

    const response = await PUT(putRequest({ expiresAt: null }), {
      params: Promise.resolve({ id: storedKey.id }),
    });
    expect(response.status).toBe(500);
    expect(await json(response)).toEqual({ error: "Failed to update key" });
  });
});
