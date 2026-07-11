import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  dispatch: vi.fn(),
  heartbeat: vi.fn(),
  commit: vi.fn(),
  release: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  acquireQuotaReservation: mocks.acquire,
  markQuotaReservationDispatched: mocks.dispatch,
  heartbeatQuotaReservation: mocks.heartbeat,
  commitQuotaReservation: mocks.commit,
  releaseQuotaReservation: mocks.release,
}));

const { createQuotaReservationLifecycle } = await import("../../src/shared/services/quotaSelection.js");

function profile() {
  return {
    tracked: true,
    freshness: "fresh",
    gateMode: "all-required",
    effectiveRatio: 0.5,
    reason: "available",
    reservationAlternatives: [[{
      accountKey: "scope:connection",
      resourceKey: "scope:account",
      dimensionKey: "requests:session",
      requiredAmount: 1,
    }]],
  };
}

function lifecycle(options = {}) {
  return createQuotaReservationLifecycle({
    quotaProfile: profile(),
    connectionId: "conn-1",
    provider: "kiro",
    routeKey: "kiro/claude-sonnet",
    ...options,
  });
}

describe("quota reservation lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquire.mockResolvedValue({ acquired: true, reservationId: "reservation-1" });
    mocks.dispatch.mockResolvedValue({ changed: true, state: "active", dispatchedAt: "2026-07-10T12:00:00.000Z" });
    mocks.heartbeat.mockResolvedValue({ changed: true });
    mocks.commit.mockResolvedValue({ changed: true, state: "committed" });
    mocks.release.mockResolvedValue({ changed: true, state: "released" });
  });

  it("is a true no-op when quota has no compatible capacity plan", async () => {
    const noop = createQuotaReservationLifecycle({
      quotaProfile: { tracked: false, reservationAlternatives: [] },
      connectionId: "conn-1",
      provider: "kiro",
    });
    expect(await noop.beginDispatch()).toMatchObject({ tracked: false, reservationId: null });
    expect(await noop.settle({ success: true })).toEqual({ changed: false });
    expect(mocks.acquire).not.toHaveBeenCalled();
  });

  it("acquires, dispatches, heartbeats, and commits once", async () => {
    let clock = 1_000_000;
    const attempt = lifecycle({ now: () => clock });
    const ticket = await attempt.beginDispatch();
    expect(ticket).toMatchObject({ tracked: true, reservationId: "reservation-1" });
    expect(mocks.dispatch).toHaveBeenCalledOnce();
    clock += 30_001;
    ticket.heartbeat();
    await vi.waitFor(() => expect(mocks.heartbeat).toHaveBeenCalledOnce());
    expect(await attempt.settle({ success: true })).toMatchObject({ changed: true });
    expect(await attempt.settle({ success: false, reason: "stream_cancel" })).toEqual({ changed: false });
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.acquire.mock.calls[0][0]).not.toHaveProperty("id");
    expect(mocks.acquire.mock.calls[0][0].routeKeyHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("throws a typed local-capacity decision without dispatching", async () => {
    mocks.acquire.mockResolvedValue({ acquired: false, reason: "capacity_exhausted" });
    const attempt = lifecycle();
    await expect(attempt.beginDispatch()).rejects.toMatchObject({
      code: "QUOTA_DISPATCH_UNAVAILABLE",
      reason: "capacity_exhausted",
    });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("fails open without dispatch bookkeeping when capacity becomes untracked", async () => {
    mocks.acquire.mockResolvedValue({ acquired: false, reason: "untracked" });
    const attempt = lifecycle();
    const ticket = await attempt.beginDispatch();
    expect(ticket).toMatchObject({ tracked: false, reservationId: null });
    expect(await attempt.settle({ success: true })).toEqual({ changed: false });
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("releases pre-dispatch/failure paths once", async () => {
    const attempt = lifecycle();
    const ticket = await attempt.beginDispatch();
    expect(await ticket.release("pre_dispatch")).toMatchObject({ changed: true, state: "released" });
    expect(await ticket.release("fallback")).toEqual({ changed: false });
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.release.mock.calls[0][1]).toBe("pre_dispatch");
  });

  it("passes connection/window routing-floor precedence into the atomic acquire", async () => {
    const attempt = lifecycle({
      config: {
        routingFloorEnabled: false,
        routingFloorRatio: 0.01,
        providers: { kiro: { routingFloorEnabled: true, routingFloorRatio: 0.02 } },
        connections: {
          "conn-1": {
            dimensions: {
              "requests:session": { routingFloorEnabled: true, routingFloorRatio: 0.03 },
            },
          },
        },
      },
    });
    await attempt.beginDispatch();
    expect(mocks.acquire.mock.calls[0][0].alternatives[0][0]).toMatchObject({
      routingFloorEnabled: true,
      routingFloorRatio: 0.03,
    });
  });

  it("uses a distinct ticket for each physical retry and settles each once", async () => {
    mocks.acquire
      .mockResolvedValueOnce({ acquired: true, reservationId: "reservation-1" })
      .mockResolvedValueOnce({ acquired: true, reservationId: "reservation-2" });
    const attempt = lifecycle();
    const first = await attempt.beginDispatch();
    await first.release("fallback");
    const second = await attempt.beginDispatch();
    expect(second.reservationId).toBe("reservation-2");
    expect(mocks.acquire).toHaveBeenCalledTimes(2);
    expect(mocks.dispatch).toHaveBeenCalledTimes(2);

    expect(await attempt.settle({ success: true })).toMatchObject({ changed: true });
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.release.mock.calls[0][0]).toBe("reservation-1");
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.commit.mock.calls[0][0]).toBe("reservation-2");
  });
});
