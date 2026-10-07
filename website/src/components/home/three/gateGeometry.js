import { ExtrudeGeometry } from "three";
import * as THREE from "three";

export const GATE_RADIUS = 1.15;
export const GATE_BOTTOM = -2.6;

/** An arched slab whose local origin is its outer hinge, including its thickness. */
export function createGateLeaf(side) {
  const r = GATE_RADIUS;
  const contour = new THREE["Shape"]();
  if (side < 0) {
    contour.moveTo(-r, GATE_BOTTOM);
    contour.lineTo(0, GATE_BOTTOM);
    contour.lineTo(0, r);
    contour.absarc(0, 0, r, Math.PI / 2, Math.PI, false);
    contour.lineTo(-r, GATE_BOTTOM);
  } else {
    contour.moveTo(0, GATE_BOTTOM);
    contour.lineTo(r, GATE_BOTTOM);
    contour.lineTo(r, 0);
    contour.absarc(0, 0, r, 0, Math.PI / 2, false);
    contour.lineTo(0, GATE_BOTTOM);
  }
  contour.closePath();
  const geometry = new ExtrudeGeometry(contour, {
    depth: 0.18,
    curveSegments: 40,
    bevelEnabled: true,
    bevelThickness: 0.018,
    bevelSize: 0.014,
    bevelSegments: 2,
  });
  geometry.translate(-side * r, 0, -0.16);
  return geometry;
}
