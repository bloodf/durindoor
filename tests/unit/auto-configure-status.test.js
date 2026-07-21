import { describe, expect, it } from "vitest";
import { serviceStatus } from "@/app/(dashboard)/dashboard/auto-configure/autoConfigureStatus.js";

describe("auto-configure status presentation", () => {
  it("treats a reachable external service as available without a local install", () => {
    expect(serviceStatus({ installed: false, running: true, wouldChange: false }, true)).toEqual({
      label: "Up to date",
      variant: "success",
    });
  });

  it("keeps an absent service unavailable", () => {
    expect(serviceStatus({ installed: false, running: false, wouldChange: false }, true)).toEqual({
      label: "Unavailable",
      variant: "default",
    });
  });
});
