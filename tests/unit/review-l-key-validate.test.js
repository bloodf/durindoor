import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createApiKey: vi.fn(), updateApiKey: vi.fn(), getApiKeyById: vi.fn(),
  getConsistentMachineId: vi.fn(), canManageAccessConfig: vi.fn(),
}));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init = {}) => Response.json(body, init) } }));
vi.mock("@/dashboardGuard", () => ({ canManageAccessConfig: mocks.canManageAccessConfig, isOperatorRequest: vi.fn().mockResolvedValue(true) }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: mocks.getConsistentMachineId }));
vi.mock("@/lib/localDb", () => ({
  ...mocks, getProviderConnections: vi.fn(), getApiKeyProviderConnectionIds: vi.fn().mockResolvedValue([]),
  getApiKeyUsageTotals: vi.fn().mockResolvedValue({}), getGroupIdsForApiKey: vi.fn().mockResolvedValue([]),
}));

const { POST } = await import("@/app/api/keys/route.js");
const { PUT } = await import("@/app/api/keys/[id]/route.js");
const request = (body) => ({ json: async () => body });
const params = { params: Promise.resolve({ id: "key-id" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canManageAccessConfig.mockResolvedValue(true);
  mocks.getConsistentMachineId.mockResolvedValue("machine");
  mocks.getApiKeyById.mockResolvedValue({ id: "key-id", allowedCombos: ["combo-a"] });
  mocks.createApiKey.mockImplementation(async (_name, _machine, allowedCombos) => ({ allowedCombos }));
  mocks.updateApiKey.mockImplementation(async (_id, changes) => ({ id: "key-id", ...changes }));
});

describe("API key field validation", () => {
  it.each(["combo-a", 1, false, {}, ["combo-a", 1]].map((value) => [value]))("rejects invalid allowedCombos on creation: %j", async (value) => {
    expect((await POST(request({ name: "key", allowedCombos: value }))).status).toBe(400);
    expect(mocks.createApiKey).not.toHaveBeenCalled();
  });
  it.each(["combo-a", 1, false, {}, null, ["combo-a", 1]].map((value) => [value]))("rejects invalid allowedCombos on update: %j", async (value) => {
    expect((await PUT(request({ allowedCombos: value }), params)).status).toBe(400);
    expect(mocks.updateApiKey).not.toHaveBeenCalled();
  });
  it.each(["true", 1, null, {}, []].map((value) => [value]))("rejects invalid isActive on update: %j", async (value) => {
    expect((await PUT(request({ isActive: value }), params)).status).toBe(400);
    expect(mocks.updateApiKey).not.toHaveBeenCalled();
  });
  it("rejects invalid isActive on creation", async () => {
    expect((await POST(request({ name: "key", isActive: "true" }))).status).toBe(400);
    expect(mocks.createApiKey).not.toHaveBeenCalled();
  });
  it("accepts valid scopes and booleans and creation defaults", async () => {
    for (const allowedCombos of [undefined, null, [], ["combo-a"]]) {
      expect((await POST(request({ name: "key", allowedCombos }))).status).toBe(201);
    }
    for (const isActive of [true, false]) {
      expect((await PUT(request({ isActive, allowedCombos: ["combo-a"] }), params)).status).toBe(200);
    }
  });
});

vi.mock("@/lib/db/driver.js", () => ({ getAdapter: () => ({
  get: () => ({ id: "key-id", allowedCombos: '["combo-a"]', isActive: 1 }),
  transaction: (fn) => fn(), run: vi.fn(),
}) }));

it("rejects malformed repository writes before they can clear a scope", async () => {
  const { createApiKey, updateApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
  for (const value of ["combo-a", false, ["combo-a", 1]]) {
    await expect(createApiKey("key", "machine", value)).rejects.toThrow(TypeError);
    await expect(updateApiKey("key-id", { allowedCombos: value })).rejects.toThrow(TypeError);
  }
  await expect(updateApiKey("key-id", { isActive: "true" })).rejects.toThrow(TypeError);
});
