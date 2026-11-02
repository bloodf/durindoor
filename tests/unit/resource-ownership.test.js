import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  keys: new Map(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeyByKey: async (key) => mocks.keys.get(key) ?? null,
  getSettings: mocks.getSettings,
  getProviderConnections: vi.fn(),
  getProxyPools: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
}));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: async () => "owner-cli-token" }));

const { resolveClientApiKey } = await import("@/sse/services/auth.js");
const { resolveResourceOwner } = await import("@/sse/services/resourceOwnership.js");
const request = (headers = {}) => new Request("http://localhost/v1/files", { headers });

describe.each([false, true])("Files/Batches ownership (accepted auth supplied=%s)", (supplied) => {
  async function owner(req) {
    if (!supplied) return resolveResourceOwner(req);
    const settings = await mocks.getSettings();
    const { auth } = await resolveClientApiKey(req, { required: settings.requireApiKey === true });
    return resolveResourceOwner(req, auth);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.keys.clear();
    mocks.keys.set("sk-bearer", { id: "bearer-owner", isActive: true, expiresAt: null });
    mocks.keys.set("sk-header", { id: "header-owner", isActive: true, expiresAt: null });
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
  });

  it("uses a distinct global operator identity only for a valid CLI token", async () => {
    await expect(owner(request({ "x-9r-cli-token": "owner-cli-token", authorization: "Bearer sk-bearer" }))).resolves.toEqual({
      authorized: true, ownerId: "operator", allowAllOwners: true,
    });
    await expect(owner(request({ "x-9r-cli-token": "wrong", authorization: "Bearer sk-bearer" }))).resolves.toEqual({
      authorized: true, ownerId: "bearer-owner", allowAllOwners: false,
    });
  });

  it.each([{}, { authorization: "Bearer sk_durindoor" }])("permits local fallback only with enforcement off: %j", async (headers) => {
    await expect(owner(request(headers))).resolves.toEqual({ authorized: true, ownerId: "local", allowAllOwners: false });
    mocks.getSettings.mockResolvedValue({ requireApiKey: true });
    await expect(owner(request(headers))).resolves.toEqual({ authorized: false, ownerId: null, allowAllOwners: false });
  });

  it.each([false, true])("uses the valid x-api-key owner despite stale Bearer (required=%s)", async (required) => {
    mocks.getSettings.mockResolvedValue({ requireApiKey: required });
    await expect(owner(request({ authorization: "Bearer stale-placeholder", "x-api-key": "sk-header" }))).resolves.toEqual({
      authorized: true, ownerId: "header-owner", allowAllOwners: false,
    });
  });

  it("keeps the Bearer owner when both presented keys are valid", async () => {
    await expect(owner(request({ authorization: "Bearer sk-bearer", "x-api-key": "sk-header" }))).resolves.toEqual({
      authorized: true, ownerId: "bearer-owner", allowAllOwners: false,
    });
  });

  it.each([
    ["inactive", { isActive: false, expiresAt: null }],
    ["expired", { isActive: true, expiresAt: "2000-01-01T00:00:00.000Z" }],
  ])("rejects a stored %s key without another valid credential", async (_label, record) => {
    mocks.keys.set("sk-bearer", { id: "bearer-owner", ...record });
    await expect(owner(request({ authorization: "Bearer sk-bearer" }))).resolves.toEqual({
      authorized: false, ownerId: null, allowAllOwners: false,
    });
    await expect(owner(request({ authorization: "Bearer sk-bearer", "x-api-key": "sk-header" }))).resolves.toEqual({
      authorized: true, ownerId: "header-owner", allowAllOwners: false,
    });
  });
});
