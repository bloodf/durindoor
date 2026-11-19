import { describe, expect, it } from "vitest";
import { mapWithConcurrency, MAX_IN_FLIGHT } from "../../src/lib/lanDiscovery/concurrency.js";

describe("lan discovery concurrency limiter", () => {
  it("keeps the default probe ceiling at 32", () => {
    expect(MAX_IN_FLIGHT).toBe(32);
  });

  it("never runs more than the limit in flight", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const tasks = Array.from({ length: 80 }, (_, i) => async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return i;
    });

    const results = await mapWithConcurrency(tasks, 8);
    expect(results).toEqual(Array.from({ length: 80 }, (_, i) => i));
    expect(maxInFlight).toBeLessThanOrEqual(8);
    expect(maxInFlight).toBe(8);
  });
});
