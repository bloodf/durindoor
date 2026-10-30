// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import AutoConfigureClient from "@/app/(dashboard)/dashboard/auto-configure/AutoConfigureClient.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it("recovers failed status using a read, without running configuration", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ services: { headroom: { running: true, installed: true } } }))));
  try {
    await act(async () => root.render(React.createElement(AutoConfigureClient, { status: null, initialError: "Status unavailable" })));
    expect(host.querySelector('[role="alert"]').textContent).toContain("Status unavailable");
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent.includes("Retry status")).click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain("Headroom");
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/settings/auto-configure");
  } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
