import { describe, expect, it } from "vitest";
import { createGateLeaf, GATE_RADIUS, GATE_BOTTOM } from "../../website/src/components/home/three/gateGeometry.js";

describe("solid arched gateway leaves", () => {
  it.each([-1, 1])("keeps side %s on its outer hinge with a real thickness", (side) => {
    const geometry = createGateLeaf(side);
    geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox;
    expect(max.z - min.z).toBeGreaterThan(0.18);
    expect(min.y).toBeCloseTo(GATE_BOTTOM, 1);
    expect(max.y).toBeCloseTo(GATE_RADIUS, 1);
    expect(side < 0 ? min.x : max.x).toBeCloseTo(0, 1);
    expect(side < 0 ? max.x : min.x).toBeCloseTo(-side * GATE_RADIUS, 1);
    geometry.dispose();
  });
  it("places the closed leaves symmetrically so the seam meets at the center", () => {
    const left = createGateLeaf(-1), right = createGateLeaf(1);
    left.computeBoundingBox(); right.computeBoundingBox();
    expect(left.boundingBox.max.x - GATE_RADIUS).toBeCloseTo(0, 1);
    expect(right.boundingBox.min.x + GATE_RADIUS).toBeCloseTo(0, 1);
    left.dispose(); right.dispose();
  });
});
