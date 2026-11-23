import { describe, expect, it, vi } from "vitest";
import { applyQuotaProviderOrder, moveQuotaProvider, quotaProviderOrder } from "../../src/shared/utils/quotaProviderOrder.js";

const accounts = [
  { id: "a1", provider: "a", priority: 1 },
  { id: "b1", provider: "b", priority: 1 },
  { id: "a2", provider: "a", priority: 2 },
  { id: "c1", provider: "c", priority: 1 }
];

describe("quota provider display order", () => {
  it("orders before pagination without changing account priority or its input", () => {
    const ordered = applyQuotaProviderOrder(accounts, ["c", "a", "b"]);
    expect(ordered.slice(0, 2).map((a) => a.id)).toEqual(["c1", "a1"]);
    expect(ordered.slice(2).map((a) => a.id)).toEqual(["a2", "b1"]);
    expect(accounts.map((a) => a.id)).toEqual(["a1", "b1", "a2", "c1"]);
    expect(ordered.find((a) => a.id === "a2").priority).toBe(2);
  });
  it("retains filtered and disconnected providers while merging successive moves", () => {
    const order = quotaProviderOrder(accounts, ["missing", "a", "b", "c"]);
    const first = moveQuotaProvider(order, "a", "c");
    expect(moveQuotaProvider(first, "b", "c")).toEqual(["missing", "c", "b", "a"]);
    expect(moveQuotaProvider(first, "unknown", "a")).toBe(first);
  });
  it("keeps existing sort when no order is saved", () => {
    expect(applyQuotaProviderOrder(accounts, [])).toBe(accounts);
  });
});


const mocks = vi.hoisted(() => ({ operator: vi.fn(), connections: vi.fn(), update: vi.fn() }));
vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: mocks.operator }));
vi.mock("@/lib/localDb", () => ({ getProviderConnections: mocks.connections, updateSettings: mocks.update }));
vi.mock("@/app/api/providers/client/route", () => ({ isUsageEligible: () => true }));

describe("provider order endpoint", () => {
  it("rejects non-operators without writing", async () => {
    mocks.operator.mockResolvedValue(false);
    mocks.update.mockClear();
    const { PATCH } = await import("../../src/app/api/settings/quota-provider-order/route.js");
    const response = await PATCH(new Request("http://localhost", { method: "PATCH", body: "{}" }));
    expect(response.status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("merges each move with settings inside the update transaction", async () => {
    mocks.operator.mockResolvedValue(true);
    mocks.connections.mockResolvedValue(accounts);
    let state = { quotaProviderOrder: ["a", "b", "c"] };
    mocks.update.mockImplementation(async (update) => (state = { ...state, ...update(state) }));
    const { PATCH } = await import("../../src/app/api/settings/quota-provider-order/route.js");
    const request = (provider, target) => new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ provider, target }) });
    const responses = await Promise.all([PATCH(request("a", "c")), PATCH(request("b", "c"))]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(state.quotaProviderOrder).toEqual(["c", "b", "a"]);
  });
  it("reports a failed save", async () => {
    mocks.operator.mockResolvedValue(true);
    mocks.connections.mockResolvedValue(accounts);
    mocks.update.mockRejectedValueOnce(new Error("database unavailable"));
    const { PATCH } = await import("../../src/app/api/settings/quota-provider-order/route.js");
    const response = await PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ provider: "a", target: "b" }) }));
    expect(response.status).toBe(500);
  });
});
