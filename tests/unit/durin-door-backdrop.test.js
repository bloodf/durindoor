// Unit tests for the Doors of Durin login backdrop helpers.
//
// The pure helpers (parseCssColor / readBackdropPalette / resolveBackdropMode)
// carry the fallback contract: WebGL first, Canvas 2D when WebGL is
// unavailable, no canvas work otherwise; prefers-reduced-motion always renders
// a single static frame instead of starting the animation loop.

import { describe, it, expect } from "vitest";
import {
  parseCssColor,
  readBackdropPalette,
  resolveBackdropMode,
  startDurinDoorBackdrop,
} from "../../src/shared/ui/login/durinDoorBackdrop.js";

describe("parseCssColor", () => {
  it("parses 6-digit hex into float rgb", () => {
    expect(parseCssColor("#10E882")).toEqual([16 / 255, 232 / 255, 130 / 255]);
    expect(parseCssColor("#03543B")).toEqual([3 / 255, 84 / 255, 59 / 255]);
  });

  it("parses 3-digit hex by expanding each channel", () => {
    expect(parseCssColor("#fff")).toEqual([1, 1, 1]);
    expect(parseCssColor("#000")).toEqual([0, 0, 0]);
  });

  it("parses rgb() and rgba() channel lists, ignoring alpha", () => {
    expect(parseCssColor("rgb(16, 232, 130)")).toEqual([16 / 255, 232 / 255, 130 / 255]);
    expect(parseCssColor("rgba(3, 84, 59, 0.12)")).toEqual([3 / 255, 84 / 255, 59 / 255]);
  });

  it("returns null for non-strings and unrecognized values", () => {
    expect(parseCssColor(null)).toBeNull();
    expect(parseCssColor(undefined)).toBeNull();
    expect(parseCssColor(42)).toBeNull();
    expect(parseCssColor("")).toBeNull();
    expect(parseCssColor("var(--dd-accent)")).toBeNull();
    expect(parseCssColor("#12")).toBeNull();
  });
});

describe("readBackdropPalette", () => {
  it("reads stone, mortar, and glow from the dd-* custom properties", () => {
    const style = {
      getPropertyValue(name) {
        return {
          "--dd-bg": "#0E0D0B",
          "--dd-surface-2": "#22201C",
          "--dd-accent": "#10E882",
        }[name] ?? "";
      },
    };
    const palette = readBackdropPalette(style);
    expect(palette.stone).toEqual([14 / 255, 13 / 255, 11 / 255]);
    expect(palette.mortar).toEqual([34 / 255, 32 / 255, 28 / 255]);
    expect(palette.glow).toEqual([16 / 255, 232 / 255, 130 / 255]);
  });

  it("falls back to dark defaults when properties are missing or unparsable", () => {
    const palette = readBackdropPalette({ getPropertyValue: () => "" });
    expect(palette.stone).toHaveLength(3);
    expect(palette.mortar).toHaveLength(3);
    expect(palette.glow).toHaveLength(3);
    // Missing stylesheet must not crash and must not yield NaN channels.
    for (const color of [palette.stone, palette.mortar, palette.glow]) {
      for (const channel of color) {
        expect(Number.isFinite(channel)).toBe(true);
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });

  it("tolerates a missing style object entirely", () => {
    const palette = readBackdropPalette(undefined);
    expect(palette.glow).toHaveLength(3);
  });
});

describe("resolveBackdropMode", () => {
  it("prefers WebGL with animation when supported and motion is allowed", () => {
    expect(resolveBackdropMode(true, true, false)).toEqual({ renderer: "webgl", animated: true });
  });

  it("falls back to Canvas 2D when WebGL is unavailable", () => {
    expect(resolveBackdropMode(false, true, false)).toEqual({ renderer: "canvas2d", animated: true });
  });

  it("renders nothing when neither renderer is available", () => {
    expect(resolveBackdropMode(false, false, false)).toEqual({ renderer: "none", animated: false });
  });

  it("reduced motion keeps the renderer but disables the animation loop", () => {
    expect(resolveBackdropMode(true, true, true)).toEqual({ renderer: "webgl", animated: false });
    expect(resolveBackdropMode(false, true, true)).toEqual({ renderer: "canvas2d", animated: false });
  });

  it("reduced motion with no renderer stays inert", () => {
    expect(resolveBackdropMode(false, false, true)).toEqual({ renderer: "none", animated: false });
  });
});

describe("startDurinDoorBackdrop", () => {
  it("returns an inert controller for a missing or non-canvas element", () => {
    const controller = startDurinDoorBackdrop(null);
    expect(() => controller.destroy()).not.toThrow();
    expect(() => startDurinDoorBackdrop({}).destroy()).not.toThrow();
  });
});
