import { expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ getProviderConnectionById: vi.fn(), updateProviderConnection: vi.fn(), getProviderNodeById: vi.fn(), getProxyPoolById: vi.fn(), deleteProviderConnection: vi.fn() }));
vi.mock("@/models", () => db);
vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: vi.fn(async () => true), canManageAccessConfig: vi.fn(async () => true) }));
vi.mock("@/shared/services/quotaAutoPing", () => ({ notifyQuotaAutoPingSettingChanged: vi.fn() }));
import { PUT } from "../../src/app/api/providers/[id]/route.js";

it("schedules, suspends and clears quota lockout without enabling the connection", async () => {
  let connection = { id: "conn", provider: "z-ai", authType: "apikey", isActive: false };
  db.getProviderConnectionById.mockImplementation(async () => connection);
  db.updateProviderConnection.mockImplementation(async (_id, patch) => (connection = { ...connection, ...patch }));
  const put = (quotaLockout) => PUT(new Request("http://localhost/api/providers/conn", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ quotaLockout }) }), { params: Promise.resolve({ id: "conn" }) });
  expect((await put({ reactivateAt: "2099-01-01T00:00:00Z" })).status).toBe(200);
  expect(connection.quotaLockout).toMatchObject({ source: "manual", reactivateAt: "2099-01-01T00:00:00.000Z" });
  expect((await put({ reactivateAt: null })).status).toBe(200);
  expect(connection.quotaLockout.reactivateAt).toBeNull();
  expect((await put(null)).status).toBe(200);
  expect(connection.quotaLockout).toBeNull();
  expect(connection.isActive).toBe(false);
  expect((await put({ reactivateAt: "invalid" })).status).toBe(400);
});
