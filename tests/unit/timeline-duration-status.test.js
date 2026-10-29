// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "example-trace" }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
import TimelineDetailPage from "@/app/(dashboard)/dashboard/timeline/[id]/page.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("trace detail with unavailable duration", () => {
  let container, root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it.each(["running", "ok", "error", "aborted"])("announces ongoing work only for running status, not unknown completed timing (%s)", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async (url) => ({
      ok: true, status: 200,
      json: async () => url === "/api/providers" ? { connections: [] } : {
        trace: { id: "example-trace", status, total_ms: null },
        events: [{ seq: 1, t_ms: 30, type: "route", direction: "system", payload: { selected: "example-provider" } }],
      },
    })));
    await act(async () => root.render(React.createElement(TimelineDetailPage)));
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(status === "running" ? 1 : 0);
    const waterfall = container.querySelector('ol[aria-label="Trace waterfall"]');
    const row = waterfall.querySelector("button");
    expect(row.textContent).toContain("30–30 ms"); // Last known event time, not invented elapsed duration.
    act(() => row.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(waterfall.querySelector('[role="region"]').textContent).toContain("example-provider");
  });
});
