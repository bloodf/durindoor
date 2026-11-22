import { beforeEach, describe, expect, it } from "vitest";
import { comboConversationAffinity, getRotatedModels, resetComboRotation } from "../../open-sse/services/combo.js";
import { acquireMany, acquireSlot, releaseSlot, _resetGates } from "../../open-sse/services/concurrencyGate.js";

beforeEach(() => { resetComboRotation(); _resetGates(); });

describe("API key isolation", () => {
  it("keeps identical conversation IDs and eviction budgets separate", () => {
    const rotate = (id, key) => getRotatedModels(["a", "b"], "combo", "round-robin", 2, id, [], key);
    expect(rotate("same", "key-a")[0]).toBe("a");
    rotate("other", "key-a");
    expect(rotate("same", "key-b")[0]).toBe("b");
    for (let i = 0; i < 1001; i++) rotate(`flood-${i}`, "key-b");
    expect(rotate("same", "key-a")[0]).toBe("a");
    expect(comboConversationAffinity.size).toBeGreaterThan(1000);
  });

  it("bounds each key's queue while allowing another key to wait", async () => {
    await acquireSlot("provider", 1);
    const controller = new AbortController();
    const waiters = Array.from({ length: 32 }, () => acquireSlot("provider", 1, 5000, controller.signal, "key-a"));
    const settled = Promise.allSettled(waiters);
    await expect(Promise.race([acquireSlot("provider", 1, 5000, controller.signal, "key-a").then(() => "acquired", () => "rejected"), new Promise((resolve) => setTimeout(() => resolve("waiting"), 50))])).resolves.toBe("rejected");
    const other = acquireSlot("provider", 1, 5000, controller.signal, "key-b");
    const otherSettled = Promise.allSettled([other]);
    controller.abort();
    await settled;
    await otherSettled;
    releaseSlot("provider");
  });

  it("serves a different key before a second waiter from the same key", async () => {
    await acquireSlot("provider", 1);
    const order = [];
    const first = acquireSlot("provider", 1, 5000, null, "key-a").then(() => order.push("a1"));
    const second = acquireSlot("provider", 1, 5000, null, "key-a").then(() => order.push("a2"));
    const third = acquireSlot("provider", 1, 5000, null, "key-b").then(() => order.push("b"));
    releaseSlot("provider");
    await first;
    releaseSlot("provider");
    await third;
    releaseSlot("provider");
    await second;
    releaseSlot("provider");
    expect(order).toEqual(["a1", "b", "a2"]);
  });


  it("carries the caller identity through hierarchical admission", async () => {
    const tiers = [{ key: "provider", limit: 1 }];
    const held = await acquireMany(tiers, 5000, null, { apiKeyId: "key-a" });
    const order = [];
    const a = acquireMany(tiers, 5000, null, { apiKeyId: "key-a" }).then((release) => { order.push("a"); return release; });
    const b = acquireMany(tiers, 5000, null, { apiKeyId: "key-b" }).then((release) => { order.push("b"); return release; });
    held();
    const releaseB = await b;
    releaseB();
    const releaseA = await a;
    releaseA();
    expect(order).toEqual(["b", "a"]);
  });

});
