import { describe, expect, it } from "vitest";
import CavemanOutputPreview from "../../src/app/(dashboard)/dashboard/token-saver/components/CavemanOutputPreview.jsx";
import { injectCaveman } from "../../open-sse/rtk/caveman.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

function preview(level, enabled = true) {
  const tree = CavemanOutputPreview({ level, enabled });
  return tree?.props.children;
}

describe("Caveman output instruction preview", () => {
  it.each(["lite", "full", "ultra", "wenyan-lite", "wenyan", "wenyan-ultra"])(
    "previews the full dispatched %s block, including preservation boundaries",
    (level) => {
      const body = { messages: [{ role: "user", content: "Explain the failure" }] };
      injectCaveman(body, FORMATS.OPENAI, level);
      const children = preview(level);
      expect(children[2].props.children).toBe(body.messages[0].content);
      expect(children[2].props.children).toContain("Code");
    }
  );

  it("updates the displayed instruction when the selected intensity changes", () => {
    const lite = preview("lite")[2].props.children;
    const ultra = preview("ultra")[2].props.children;
    expect(lite).toContain("Keep grammar and full sentences");
    expect(ultra).toContain("Maximum compression");
    expect(ultra).not.toBe(lite);
  });

  it("distinguishes a disabled preview from instructions being injected", () => {
    expect(preview("full", false)[1].props.children).toContain("not injected");
    expect(preview("full", true)[1].props.children).toContain("Media requests skip Caveman");
  });

  it("does not invent instructions for an unknown level", () => {
    expect(CavemanOutputPreview({ level: "unknown", enabled: true })).toBeNull();
  });
});
