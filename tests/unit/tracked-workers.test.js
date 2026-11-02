import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { createTrackedWorkers } from "../utils/trackedWorkers.js";

const pools = [];
function pool(factory) { const value = createTrackedWorkers(factory); pools.push(value); return value; }
afterEach(async () => { for (const value of pools.splice(0)) await value.close(); });
const waitingSource = 'setInterval(() => {}, 1000);';

describe("test-owned Worker cleanup", () => {
  it("terminates all live workers and waits for exit", async () => {
    const value = pool();
    const workers = [value.create(waitingSource, { eval: true }), value.create(waitingSource, { eval: true })];
    expect(value.size).toBe(2);
    await value.close();
    expect(value.size).toBe(0);
    expect(workers.map((worker) => worker.threadId)).toEqual([-1, -1]);
  });
  it("retains earlier workers for cleanup if construction later throws", async () => {
    let attempts = 0;
    const real = createTrackedWorkers();
    const value = pool((source, options) => {
      if (++attempts === 2) throw new Error("construction failure");
      return real.create(source, options);
    });
    value.create(waitingSource, { eval: true });
    expect(() => value.create(waitingSource, { eval: true })).toThrow("construction failure");
    await value.close();
    expect(value.size).toBe(0);
    expect(real.size).toBe(0);
  });
  it("can clean up independently of an unresolved caller", async () => {
    const value = pool(); const worker = value.create(waitingSource, { eval: true });
    const caller = new Promise((resolve) => worker.once("exit", resolve));
    await value.close();
    await caller;
    expect(value.size).toBe(0);
  });
  it("waits for every termination and surfaces cleanup failures", async () => {
    const failed = new EventEmitter(); failed.terminate = async () => { throw new Error("termination fault"); };
    const good = new EventEmitter(); let closed = false;
    good.terminate = async () => { closed = true; good.emit("exit", 0); };
    const queue = [failed, good]; const value = createTrackedWorkers(() => queue.shift());
    value.create(); value.create();
    await expect(value.close()).rejects.toThrow("Test worker termination failed");
    expect(closed).toBe(true);
    expect(value.size).toBe(1);
    failed.emit("exit", 0);
  });
  it("does not call terminate twice during overlapping cleanup", async () => {
    const fake = new EventEmitter(); let calls = 0;
    fake.terminate = async () => { calls += 1; fake.emit("exit", 0); };
    const value = pool(() => fake); value.create();
    await Promise.all([value.close(), value.close()]);
    expect(calls).toBe(1);
  });
});
