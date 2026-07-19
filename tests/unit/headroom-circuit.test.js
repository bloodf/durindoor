import { beforeEach, describe, expect, it, vi } from "vitest";
import { compressWithHeadroom, getHeadroomCircuitState, resetHeadroomCircuit } from "../../open-sse/rtk/headroom.js";

describe("Headroom retry circuit", () => {
  beforeEach(() => resetHeadroomCircuit());

  it("retries one transient failure and resets after success", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ role: "user", content: "short" }] }) });
    const body = { messages: [{ role: "user", content: "long" }] };
    expect(await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787", model: "x" })).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getHeadroomCircuitState().degraded).toBe(false);
  });
});
