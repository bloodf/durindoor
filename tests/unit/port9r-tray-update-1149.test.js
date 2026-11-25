// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import UpdatePanel from "../../src/shared/components/UpdatePanel.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it.each([[true, "durindoor --tray"], [false, "durindoor"]])("copies a relaunch command for tray mode %s", async (isTrayMode, launch) => {
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "Disabled" }) });
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(UpdatePanel, { installCmd: "npm i -g durindoor@latest", isTrayMode, onClose: () => {} })));
  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent.includes("Update & Restart")).click());
  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent.includes("Copy & Shutdown")).click());
  expect(writeText).toHaveBeenCalledWith(`npm i -g durindoor@latest && ${launch}`);
  await act(async () => root.unmount()); host.remove(); globalThis.fetch = fetchBefore;
});
