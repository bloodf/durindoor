import { describe, expect, it } from "vitest";

const { getPxpipeStatusView } = await import("../../src/app/(dashboard)/dashboard/pxpipe/pxpipeStatus.js");

describe("saver production status presentation", () => {
  it("distinguishes healthy, stopped, missing, and unavailable pxpipe states", () => {
    expect(getPxpipeStatusView({ running: true }, { healthy: true })).toMatchObject({ label: "Healthy", dependencyMissing: false });
    expect(getPxpipeStatusView({ installed: true, running: false })).toMatchObject({ label: "Stopped", dependencyMissing: false });
    expect(getPxpipeStatusView({ installed: false })).toMatchObject({ label: "Not installed", dependencyMissing: true });
    expect(getPxpipeStatusView({ error: "service unavailable" })).toMatchObject({ label: "Unavailable", error: "service unavailable" });
  });
});
