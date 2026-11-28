// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { within } from "@testing-library/dom";
import DatabaseSettingsPage from "../../src/app/(dashboard)/dashboard/settings/database/page.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("preserves the engine status failure message for a JSON error response", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: "boom" }),
  })));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(React.createElement(DatabaseSettingsPage, { initialPassword: "secret" }));
    });
    expect(within(host).getByRole("alert").textContent).toContain("Failed to load (500)");
    expect(host.textContent).not.toContain("boom");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
