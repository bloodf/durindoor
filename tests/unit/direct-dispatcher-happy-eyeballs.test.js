import { describe, expect, it } from "vitest";
import { getDirectDispatcherOptionsForTest } from "../../open-sse/utils/proxyFetch.js";

describe("direct egress dispatcher", () => {
  it("enables Happy Eyeballs for direct fetches", () => {
    const options = getDirectDispatcherOptionsForTest();

    expect(options.connect.autoSelectFamily).toBe(true);
    expect(options.connect.autoSelectFamilyAttemptTimeout).toBe(1000);
  });
});
