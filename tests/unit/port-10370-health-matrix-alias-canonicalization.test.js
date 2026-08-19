import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  getHealthPayload,
  invalidateHealthCache,
} from "../../src/lib/healthMonitor.js";
import { resolveProviderAlias } from "open-sse/services/model.js";

const CONN = (id, provider, name = id) => ({ id, provider, name, isActive: true });

function fakeClock(start = 0) {
  let t = start;
  return { now: () => t };
}

describe("port-10370: healthMonitor canonicalizes provider aliases for grouping", () => {
  beforeEach(() => invalidateHealthCache());

  const prober = async () => ({ valid: true, status: 200 });

  it("groups aimlapi and aiml into a single quotaInspector call under the canonical id", async () => {
    const clock = fakeClock();
    const loader = async () => [CONN("a-1", "aimlapi"), CONN("a-2", "aiml")];
    const calls = [];
    const quotaInspector = vi.fn(async (connections) => {
      calls.push({ provider: connections[0]?.provider, groupIds: connections.map((c) => c.id) });
      return new Map(connections.map((c) => [c.id, { eligible: true, skip: false, reason: "available", freshness: "fresh" }]));
    });

    await getHealthPayload({
      now: clock.now,
      connectionsLoader: loader,
      prober,
      quotaInspector,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].groupIds.sort()).toEqual(["a-1", "a-2"]);
    const passed = quotaInspector.mock.calls[0][1].provider;
    expect(passed).toBe("aimlapi");
    expect(passed).toBe(resolveProviderAlias("aiml"));
  });

  it("groups alibaba and ali into a single quotaInspector call under the canonical id", async () => {
    const clock = fakeClock();
    const loader = async () => [CONN("a-1", "alibaba"), CONN("a-2", "ali")];
    const calls = [];
    const quotaInspector = vi.fn(async (connections) => {
      calls.push({ provider: connections[0]?.provider, groupIds: connections.map((c) => c.id) });
      return new Map(connections.map((c) => [c.id, { eligible: true, skip: false, reason: "available", freshness: "fresh" }]));
    });

    await getHealthPayload({ now: clock.now, connectionsLoader: loader, prober, quotaInspector });

    expect(calls).toHaveLength(1);
    expect(calls[0].groupIds.sort()).toEqual(["a-1", "a-2"]);
    expect(quotaInspector.mock.calls[0][1].provider).toBe("alibaba");
  });

  it("groups api-airforce and af into a single quotaInspector call under the canonical id", async () => {
    const clock = fakeClock();
    const loader = async () => [CONN("a-1", "api-airforce"), CONN("a-2", "af")];
    const calls = [];
    const quotaInspector = vi.fn(async (connections) => {
      calls.push({ groupIds: connections.map((c) => c.id) });
      return new Map(connections.map((c) => [c.id, { eligible: true, skip: false, reason: "available", freshness: "fresh" }]));
    });

    await getHealthPayload({ now: clock.now, connectionsLoader: loader, prober, quotaInspector });

    expect(calls).toHaveLength(1);
    expect(calls[0].groupIds.sort()).toEqual(["a-1", "a-2"]);
    expect(quotaInspector.mock.calls[0][1].provider).toBe("api-airforce");
  });

  it("leaves unknown literal providers in their own group (no collapse when no alias entry)", async () => {
    const clock = fakeClock();
    const loader = async () => [CONN("u-1", "exotic-no-alias-provider")];
    const calls = [];
    const quotaInspector = vi.fn(async (connections) => {
      calls.push({ provider: connections[0]?.provider, groupIds: connections.map((c) => c.id) });
      return new Map(connections.map((c) => [c.id, { eligible: true, skip: false, reason: "available", freshness: "fresh" }]));
    });

    await getHealthPayload({ now: clock.now, connectionsLoader: loader, prober, quotaInspector });

    expect(calls).toHaveLength(1);
    expect(quotaInspector.mock.calls[0][1].provider).toBe("exotic-no-alias-provider");
  });

  it("produces two distinct quotaInspector calls when canonical ids differ (aimlapi vs alibaba)", async () => {
    const clock = fakeClock();
    const loader = async () => [
      CONN("a-1", "aimlapi"),
      CONN("a-2", "aiml"),
      CONN("b-1", "alibaba"),
      CONN("b-2", "ali"),
    ];
    const seenProviders = new Set();
    const quotaInspector = vi.fn(async (connections, ctx) => {
      seenProviders.add(ctx.provider);
      return new Map(connections.map((c) => [c.id, { eligible: true, skip: false, reason: "available", freshness: "fresh" }]));
    });

    await getHealthPayload({ now: clock.now, connectionsLoader: loader, prober, quotaInspector });

    expect(quotaInspector).toHaveBeenCalledTimes(2);
    expect([...seenProviders].sort()).toEqual(["aimlapi", "alibaba"]);
  });

  it("preserves raw conn.provider in the output payload (not canonicalized for display)", async () => {
    const clock = fakeClock();
    const loader = async () => [CONN("a-1", "aimlapi"), CONN("a-2", "aiml")];
    const quotaInspector = async (connections) => new Map(connections.map((c) => [c.id, { eligible: true, skip: false, reason: "available", freshness: "fresh" }]));

    const payload = await getHealthPayload({ now: clock.now, connectionsLoader: loader, prober, quotaInspector });
    const literalIdsInOutput = payload.providers.map((p) => p.provider).sort();

    expect(literalIdsInOutput).toEqual(["aiml", "aimlapi"]);
  });
});
