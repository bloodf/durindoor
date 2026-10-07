import { describe, expect, it } from "vitest";
import { gateOpening } from "../../website/src/components/home/three/gateOpening.js";
describe("hero door opening controls", () => {
  it("starts shut and fully opens while scrolling through the hero", () => {
    expect(gateOpening(0, null)).toBe(0);
    expect(gateOpening(0.2, null)).toBeCloseTo(0.6);
    expect(gateOpening(0.4, null)).toBe(1);
    expect(gateOpening(-1, null)).toBe(0);
  });
  it("lets the visitor explicitly open and close regardless of scroll", () => {
    expect(gateOpening(0, true)).toBe(1);
    expect(gateOpening(1, false)).toBe(0);
  });
});
