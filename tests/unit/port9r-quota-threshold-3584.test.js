import { describe, it, expect, vi, beforeEach } from "vitest";
const db = vi.hoisted(() => ({ getProviderConnectionById: vi.fn(), listProviderQuotaSnapshots: vi.fn(), updateSettings: vi.fn(), acquireQuotaReservation: vi.fn(), markQuotaReservationDispatched: vi.fn() }));
vi.mock("@/lib/localDb", () => db);
vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: vi.fn(async () => true) }));
import { PUT } from "@/app/api/providers/[id]/quota-threshold/route.js";
import { resolveQuotaRoutingFloor } from "open-sse/config/quotaSelection.js";
import { rankQuotaConnections, createQuotaReservationLifecycle } from "@/shared/services/quotaSelection.js";
const request = (body) => new Request("http://localhost", { method: "PUT", body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: "c1" }) };
let settings;
beforeEach(() => {
  settings = { quotaSelection: { routingFloorEnabled: true, routingFloorRatio: 0.05 } };
  db.getProviderConnectionById.mockResolvedValue({ id: "c1", provider: "claude" });
  db.listProviderQuotaSnapshots.mockResolvedValue([{ identity: { dimensionKey: "requests:session" } }]);
  db.updateSettings.mockImplementation(async (update) => { settings = { ...settings, ...update(settings) }; });
});
describe("quota pause thresholds", () => {
  it("validates thresholds and restores inherited settings when cleared", async () => {
    for (const body of [{ dimensionKey: "requests:session", percent: 101 }, { dimensionKey: "requests:session", percent: "10" }, { dimensionKey: "bad", percent: 10 }]) expect((await PUT(request(body), params)).status).toBe(400);
    expect((await PUT(request({ dimensionKey: "requests:session", percent: 20 }), params)).status).toBe(200);
    const scope = { connectionId: "c1", provider: "claude", dimensionKey: "requests:session" };
    expect(resolveQuotaRoutingFloor(settings.quotaSelection, scope)).toEqual({ enabled: true, ratio: 0.2 });
    await PUT(request({ dimensionKey: "requests:session", percent: null }), params);
    expect(resolveQuotaRoutingFloor(settings.quotaSelection, scope)).toEqual({ enabled: true, ratio: 0.05 });
  });
  it("passes the window floor into reservation admission", async () => {
    await PUT(request({ dimensionKey: "requests:session", percent: 20 }), params);
    db.acquireQuotaReservation.mockResolvedValue({ acquired: true, reservationId: "r1" });
    db.markQuotaReservationDispatched.mockResolvedValue({ changed: true });
    const lifecycle = createQuotaReservationLifecycle({ connectionId: "c1", provider: "claude", config: settings.quotaSelection, quotaProfile: { reservationAlternatives: [[{ dimensionKey: "requests:session" }]] } });
    await lifecycle.beginDispatch();
    expect(db.acquireQuotaReservation.mock.calls.at(-1)[0].alternatives[0][0]).toMatchObject({ routingFloorEnabled: true, routingFloorRatio: 0.2 });
  });
  it("blocks a low window and recovers with higher quota", async () => {
    await PUT(request({ dimensionKey: "requests:session", percent: 20 }), params);
    const connection = { id: "c1", provider: "claude" };
    const rank = (ratio) => rankQuotaConnections([connection], new Map([["c1", { quotaProfile: { tracked: true, freshness: "fresh", comparisonKey: "requests", gateMode: "all-required", effectiveRatio: ratio, routingWindows: [{ dimensionKey: "requests:session", ratio }] } }]]), new Map(), { config: settings.quotaSelection })[0];
    expect(rank(0.1).quotaDecision.reasons).toContain("below_routing_floor");
    expect(rank(0.3).quotaDecision.reasons).not.toContain("below_routing_floor");
    const unknown = rankQuotaConnections([connection], new Map(), new Map(), { config: settings.quotaSelection })[0];
    expect(unknown.quotaDecision.eligible).toBe(true);
  });
});
