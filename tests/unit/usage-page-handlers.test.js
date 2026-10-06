// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const state = vi.hoisted(() => ({ stats: [], params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => state.params, useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/shared/components", () => ({
  CardSkeleton: () => null,
  RequestLogger: () => null,
  UsageStats: (props) => { state.stats.push(props); return React.createElement("div", null, "Usage totals"); },
}));
vi.mock("@/app/(dashboard)/dashboard/usage/components/RequestDetailsTab", () => ({ default: () => null }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/MonitoringWidgets", () => ({ default: () => null }));
import UsagePage from "@/app/(dashboard)/dashboard/usage/page.js";

let root;
let host;
const click = async (element) => act(async () => { element.click(); });
const button = (label) => [...document.querySelectorAll("button")].find((node) => node.textContent.trim().endsWith(label));
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  state.stats = [];
  state.params = new URLSearchParams();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("usage reset", () => {
  it("refreshes totals after a successful reset without changing the selected range", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(React.createElement(UsagePage)));
    const before = state.stats.at(-1);
    await click(button("Reset"));
    const dialog = document.body.querySelector('[role="dialog"]');
    const confirm = [...dialog.querySelectorAll("button")].find((node) => node.textContent.trim() === "Reset");
    await click(confirm);
    expect(fetch).toHaveBeenCalledWith("/api/usage/reset", expect.objectContaining({ method: "POST", body: JSON.stringify({ period: "all" }) }));
    expect(state.stats.at(-1).resetNonce).toBe(before.resetNonce + 1);
    expect(state.stats.at(-1).period).toBe(before.period);
    expect(state.stats.at(-1).customRange).toEqual(before.customRange);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});
