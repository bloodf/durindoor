// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams(), useParams: () => ({ id: "trace" }) }));
import HealthPage from "../../src/app/(dashboard)/dashboard/health/page.js";

const json = (body, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body });
let host, root;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.documentElement.removeAttribute("data-ui"); vi.unstubAllGlobals(); });
async function render(v5) { if (v5) document.documentElement.dataset.ui = "v5"; else document.documentElement.removeAttribute("data-ui"); await act(async () => { root.render(React.createElement(HealthPage)); await new Promise((resolve) => setTimeout(resolve, 0)); }); }

describe.each([false, true])("health V5=%s", (v5) => {
  it("keeps health reads and refresh writes identical across the switch", async () => {
    const calls = []; vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => { calls.push([url, options.method || "GET", options.body]); return url === "/api/health/providers" ? json({ summary: { total: 1, healthy: 0, degraded: 0, down: 1, blocked: 0, unconfigured: 0 }, providers: [{ id: "x", name: "X", provider: "x", state: "down" }] }) : json({ running: true }); }));
    await render(v5); expect(host.textContent).toContain("Down");
    const before = calls.length; const button = [...host.querySelectorAll("button")].find((node) => node.textContent.includes("Refresh"));
    await act(async () => { button.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    const writes = calls.slice(before).filter(([, method]) => method === "DELETE"); expect(writes).toEqual([["/api/health/providers", "DELETE", undefined]]);
  });
});
