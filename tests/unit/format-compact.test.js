// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { formatCompactToken } from "../../src/shared/utils/formatCompact.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/shared/components/Card", () => ({ default: ({ children }) => React.createElement("section", null, children) }));

const { default: OverviewCards } = await import("@/app/(dashboard)/dashboard/usage/components/OverviewCards.js");

describe("formatCompactToken", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1_000, "1.0k"],
    [999_999, "1.0M"],
    [1_500_000, "1.5M"],
    [999_999_999, "1.0B"],
    [1_500_000_000, "1.5B"],
  ])("formats %i as %s and preserves exact total", (value, display) => {
    expect(formatCompactToken(value)).toEqual({ display, title: new Intl.NumberFormat().format(value) });
  });

  it("renders compact total with exact accessible tooltip", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(OverviewCards, {
        stats: { totalRequests: 1, totalPromptTokens: 1_000, totalCachedTokens: 0, totalCompletionTokens: 0, totalCost: 0 },
      }));
    });

    const total = container.querySelector('[title="1,000"]');
    expect(total?.textContent).toBe("1.0k");
    expect(total?.getAttribute("aria-label")).toBe("1,000");
    await act(async () => root.unmount());
    container.remove();
  });
});
