import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@xyflow/react", () => ({
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  ReactFlow: ({ children }) => React.createElement("div", null, children),
  Controls: () => null,
}));
vi.mock("@/shared/constants/providers", () => ({ AI_PROVIDERS: {} }));
vi.mock("@/shared/utils/visiblePoller", () => ({ createVisiblePoller: () => ({ start() {}, stop() {} }) }));

const { ProviderNode } = await import("../../src/app/(dashboard)/dashboard/usage/components/ProviderTopology.js");

function render(active) {
  return renderToStaticMarkup(React.createElement(ProviderNode, {
    data: {
      label: "Codex",
      color: "#22c55e",
      imageUrl: "/providers/codex.png",
      textIcon: "CO",
      active,
      tooltipId: "provider-codex-active-keys",
      activity: [{
        model: "gpt-5.6",
        count: 3,
        keys: [
          { name: "Cursor Dev", count: 1 },
          { name: "OMP Production", count: 2 },
        ],
      }],
    },
  }));
}

describe("ProviderNode active API-key tooltip", () => {
  it("renders hover/focus tooltip markup for an active provider", () => {
    const html = render(true);
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-describedby="provider-codex-active-keys"');
    expect(html).toContain('id="provider-codex-active-keys"');
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("group-hover:visible");
    expect(html).toContain("group-focus:visible");
    expect(html).toContain("gpt-5.6 ×3");
    expect(html).toContain("OMP Production ×2");
    expect(html).toContain("Cursor Dev");
  });

  it("keeps an inactive provider non-focusable without a tooltip", () => {
    const html = render(false);
    expect(html).not.toContain("tabindex=");
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain('role="tooltip"');
  });
});
