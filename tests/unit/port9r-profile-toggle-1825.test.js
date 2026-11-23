// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import ProfilePage from "../../src/app/(dashboard)/dashboard/profile/page.js";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/profile",
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => { vi.unstubAllGlobals(); });

it("loads and persists the diagnostics toggle, retaining its state after a failed save", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let saved = true;
  let reject = false;
  const fetchMock = vi.fn(async (url, options) => {
    if (url === "/api/settings" && options?.method === "PATCH") {
      if (reject) return { ok: false };
      saved = JSON.parse(options.body).logToolSources;
    }
    return { ok: true, json: async () => ({ fallbackStrategy: "fill-first", logToolSources: saved }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const flush = () => new Promise((resolve) => setTimeout(resolve, 30));
  try {
    await act(async () => { root.render(React.createElement(ProfilePage)); await flush(); });
    await act(async () => { await flush(); });
    const tab = [...host.querySelectorAll('[role="tab"]')].find((el) => el.textContent.includes("System"));
    await act(async () => { tab.click(); await flush(); });
    const label = [...host.querySelectorAll("label")].find((el) => el.textContent === "Log tool sources");
    const toggle = host.querySelector(`[id="${label.htmlFor}"]`);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => { toggle.click(); await flush(); });
    expect(saved).toBe(false);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    reject = true;
    await act(async () => { toggle.click(); await flush(); });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(host.querySelector('[role="alert"]').textContent).toContain("Could not save tool source diagnostics");
    expect(fetchMock.mock.calls.some(([url, options]) => url === "/api/settings" && options?.body === '{"logToolSources":false}')).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
