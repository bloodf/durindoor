import { Worker } from "node:worker_threads";
import { describe, expect, it } from "vitest";

// Exercise the actual worker protocol without contacting a database. Unknown
// operations fail before Pool.query, so a large diagnostic tests error transfer.
describe("PostgreSQL oversized result transfer", () => {
  it("preserves failure status and complete error text across the secondary buffer", async () => {
    const sab = new SharedArrayBuffer(8 * 1024 * 1024);
    const header = new Int32Array(sab, 0, 2);
    const worker = new Worker(new URL("../../../src/lib/db/adapters/pgSyncWorker.cjs", import.meta.url), {
      workerData: { sab, url: "postgres://unused:unused@127.0.0.1:1/unused" },
    });
    function send(message) {
      Atomics.store(header, 0, 0);
      worker.postMessage(message);
      expect(Atomics.wait(header, 0, 0, 10_000)).not.toBe("timed-out");
    }
    try {
      const operation = "x".repeat(9 * 1024 * 1024);
      send({ op: operation });
      expect(Atomics.load(header, 0)).toBe(3);
      const resultBuffer = new SharedArrayBuffer(Atomics.load(header, 1));
      send({ op: "read-result", resultBuffer });
      expect(Atomics.load(header, 0)).toBe(2);
      expect(Atomics.load(header, 1)).toBe(0);
      expect(JSON.parse(Buffer.from(resultBuffer).toString("utf8")).message)
        .toBe(`unknown pg worker op: ${operation}`);

      // The next failure must use a fresh result, not the previous large buffer.
      send({ op: "another-invalid-operation" });
      expect(Atomics.load(header, 0)).toBe(2);
      const length = Atomics.load(header, 1);
      expect(JSON.parse(Buffer.from(sab, 8, length).toString("utf8")).message)
        .toBe("unknown pg worker op: another-invalid-operation");
    } finally {
      await worker.terminate();
    }
  });
});
