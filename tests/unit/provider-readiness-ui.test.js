import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ModelRow from "../../src/app/(dashboard)/dashboard/providers/[id]/ModelRow.js";

const render = (testStatus) => renderToStaticMarkup(React.createElement(ModelRow, {
  model: { id: "example" }, fullModel: "provider/example", onCopy: () => {}, testStatus,
}));

describe("provider model inference evidence", () => {
  it.each([
    [undefined, "Inference not tested"],
    ["ok", "Inference passed in this session"],
    ["error", "Inference failed in this session"],
    ["skipped", "Inference skipped in this session"],
  ])("labels %s without relying on icon color", (status, label) => {
    expect(render(status)).toContain(label);
  });
});
