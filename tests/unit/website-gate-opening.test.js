import { describe, expect, it } from "vitest";
import { advanceGateOpening, gateOpening } from "../../website/src/components/home/three/gateOpening.js";
describe("hero door opening controls", () => {
  it("starts shut and fully opens while scrolling through the hero", () => {
    expect(gateOpening(0, null)).toBe(0);
    expect(gateOpening(0.2, null)).toBeCloseTo(0.6);
    expect(gateOpening(0.4, null)).toBe(1);
    expect(gateOpening(-1, null)).toBe(0);
  });
  it.each([2, 30, 60])("settles open and closed on elapsed time at %i frames per second", (frames) => {
    let opening = 0;
    let closing = 1;
    for (let frame = 0; frame < frames; frame++) {
      opening = advanceGateOpening(opening, 1, 1 / frames);
      closing = advanceGateOpening(closing, 0, 1 / frames);
    }
    expect(opening).toBeCloseTo(0.950212931632136, 12);
    expect(closing).toBeCloseTo(0.049787068367864, 12);
  });
  it("lets the visitor explicitly open and close regardless of scroll", () => {
    expect(gateOpening(0, true)).toBe(1);
    expect(gateOpening(1, false)).toBe(0);
  });
});
