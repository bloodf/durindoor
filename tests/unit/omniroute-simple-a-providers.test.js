import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";



describe("OmniRoute simple/default provider batch A", () => {


  it("does not introduce duplicate registry ids", () => {
    const ids = REGISTRY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
