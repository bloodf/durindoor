import { describe, expect, it, vi } from "vitest";
import { recordProbeResult } from "../../src/app/(dashboard)/dashboard/endpoint/endpointPing.js";
import { REACHABLE_MISS_THRESHOLD } from "../../src/app/(dashboard)/dashboard/endpoint/endpointConstants.js";

describe.each(["Cloudflare", "Tailscale"])("%s client probe streak", () => {
  it("counts completed misses once, restores on success, and starts a fresh streak", () => {
    const misses = { current: 0 };
    const ever = { current: false };
    const setReachable = vi.fn();
    const setEver = vi.fn();
    const complete = (ok) => recordProbeResult(ok, misses, setReachable, ever, setEver);

    expect(misses.current).toBe(0);
    for (let i = 1; i < REACHABLE_MISS_THRESHOLD; i++) {
      complete(false);
      expect(misses.current).toBe(i);
      expect(setReachable).not.toHaveBeenCalled();
    }
    complete(false);
    expect(setReachable).toHaveBeenLastCalledWith(false);
    complete(true);
    expect(misses.current).toBe(0);
    expect(setReachable).toHaveBeenLastCalledWith(true);
    expect(setEver).toHaveBeenCalledOnce();
    complete(false);
    expect(misses.current).toBe(1);
    complete(true);
    expect(setEver).toHaveBeenCalledOnce();
  });
});
