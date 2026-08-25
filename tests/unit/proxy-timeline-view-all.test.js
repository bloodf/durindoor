import { describe, expect, it } from "vitest";
import { buildTimelineHref } from "../../src/app/(dashboard)/dashboard/timeline/href.js";

describe("buildTimelineHref", () => {
  it("builds provider View all", () => {
    expect(buildTimelineHref({ provider: "openai" })).toBe("/dashboard/timeline?provider=openai");
  });
  it("builds connection View all with connectionId", () => {
    expect(buildTimelineHref({ provider: "openai", connectionId: "c1" }))
      .toBe("/dashboard/timeline?provider=openai&connectionId=c1");
  });
});
