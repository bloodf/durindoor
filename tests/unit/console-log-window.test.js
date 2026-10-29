import { describe, expect, it } from "vitest";
import { buildConsoleLayout, consoleWindow } from "@/app/(dashboard)/dashboard/console-log/consoleLogWindow.js";

const entries = [
  { id: 0, message: "short" },
  { id: 1, message: "first\nsecond\nthird" },
  { id: 2, message: "x".repeat(200) },
  { id: 3, message: "last" },
];

describe("console window", () => {
  it("selects rows intersecting a viewport across measured, unequal heights", () => {
    const layout = buildConsoleLayout(entries, true, 600, new Map([[0, 24], [1, 96], [2, 48], [3, 24]]));
    expect(consoleWindow(layout.offsets, 24, 72, 0)).toEqual({ start: 1, end: 2 });
    expect(consoleWindow(layout.offsets, 119, 2, 0)).toEqual({ start: 1, end: 3 });
    expect(consoleWindow(layout.offsets, 168, 24, 0)).toEqual({ start: 3, end: 4 });
    expect(consoleWindow(layout.offsets, 119, 2, 1)).toEqual({ start: 0, end: 4 });
  });

  it("reflows unseen multiline rows for narrower widths and restores fixed rows when unwrapped", () => {
    const wide = buildConsoleLayout(entries, true, 900, new Map());
    const narrow = buildConsoleLayout(entries, true, 320, new Map());
    expect(narrow.height).toBeGreaterThan(wide.height);
    expect(narrow.offsets[2] - narrow.offsets[1]).toBe(72);
    const fixed = buildConsoleLayout(entries, false, 320, new Map([[1, 96]]));
    expect(consoleWindow(fixed.offsets, 24, 24, 0)).toEqual({ start: 1, end: 3 });
    expect(fixed.height).toBe(96);
  });

  it("bounds overscan at the beginning and end and handles an empty view", () => {
    const layout = buildConsoleLayout(entries, true, 600, new Map());
    expect(consoleWindow(layout.offsets, 0, 24, 20)).toEqual({ start: 0, end: 4 });
    expect(consoleWindow(layout.offsets, layout.height - 24, 24, 20)).toEqual({ start: 0, end: 4 });
    expect(consoleWindow([0], 0, 640, 20)).toEqual({ start: 0, end: 0 });
  });
});
