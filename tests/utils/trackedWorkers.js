import { Worker } from "node:worker_threads";

/** Test-owned workers must be stopped even when Vitest times out the caller. */
export function createTrackedWorkers(factory = (source, options) => new Worker(source, options)) {
  const active = new Set();
  const terminating = new Map();
  return {
    create(source, options) {
      const worker = factory(source, options);
      active.add(worker);
      worker.once("exit", () => active.delete(worker));
      return worker;
    },
    get size() { return active.size; },
    async close(workers = [...active]) {
      const results = await Promise.allSettled(workers.map((worker) => {
        if (!terminating.has(worker)) terminating.set(worker, Promise.resolve().then(() => worker.terminate()));
        return terminating.get(worker);
      }));
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length) throw new AggregateError(failures.map((result) => result.reason), "Test worker termination failed");
    },
  };
}
