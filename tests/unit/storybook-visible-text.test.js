import { describe, expect, it } from "vitest";

import { anyVisible } from "../e2e/visibleText.mjs";

const visible = { rects: 1, visibility: "visible", display: "block" };
const hidden = { rects: 0, visibility: "visible", display: "none" };
const collapsed = { rects: 1, visibility: "hidden", display: "block" };

describe("expected-visible-text matching", () => {
  it("accepts a visible match that is not the first in the DOM", () => {
    // "Settings" is a sidebar link before it is a page heading. Asserting the
    // first match failed pages whose heading was present and visible, which is
    // what left settings and profile red for a defect they did not have.
    expect(anyVisible([hidden, visible])).toBe(true);
  });

  it("fails when every match is hidden", () => {
    // The assertion must still catch text that is in the DOM but unseen, or
    // it would pass a page the user cannot actually read.
    expect(anyVisible([hidden, collapsed])).toBe(false);
  });

  it("fails when the text is absent entirely", () => {
    expect(anyVisible([])).toBe(false);
  });

  it("treats a zero-area node as not visible", () => {
    // A node with no client rects renders nothing, whatever its styles claim.
    expect(anyVisible([{ rects: 0, visibility: "visible", display: "block" }])).toBe(false);
  });
});
