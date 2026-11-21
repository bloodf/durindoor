// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AutoPingScheduleModal from "../../src/app/(dashboard)/dashboard/providers/[id]/AutoPingScheduleModal.js";
import InferenceStatus from "../../src/app/(dashboard)/dashboard/providers/[id]/InferenceStatus.jsx";
import ModelCatalogProvenance from "../../src/app/(dashboard)/dashboard/providers/[id]/ModelCatalogProvenance.js";
import NativeProviderReadiness from "../../src/app/(dashboard)/dashboard/providers/[id]/NativeProviderReadiness.jsx";
import ProviderRpmControl from "../../src/app/(dashboard)/dashboard/providers/[id]/ProviderRpmControl.jsx";
import { UI_V5_ATTRIBUTE } from "../../src/shared/ui/v5/production/uiVersion.js";
import { REVIEW_SURFACES } from "../../src/shared/ui/v5/review-manifest.js";

const storyDir = "src/app/(dashboard)/dashboard/providers/[id]";
const surfaces = [
  ["AutoPingScheduleModal.stories.jsx", "AutoPingScheduleModal.js", "AutoPingScheduleModal"],
  ["InferenceStatus.stories.jsx", "InferenceStatus.jsx", "InferenceStatus"],
  ["ModelCatalogProvenance.stories.jsx", "ModelCatalogProvenance.js", "ModelCatalogProvenance"],
  ["NativeProviderReadiness.stories.jsx", "NativeProviderReadiness.jsx", "NativeProviderReadiness"],
  ["ProviderRpmControl.stories.jsx", "ProviderRpmControl.jsx", "ProviderRpmControl"],
];
const schedule = { enabled: true, anchor: "09:30", timezone: "UTC", windowHours: 5, slotsPerDay: 3 };
const freshStatus = {
  enabled: true,
  models: ["gpt-4o"],
  syncedAt: "2020-01-01T00:00:00.000Z",
  intervalHours: 24 * 365 * 30,
};

let host;
let root;
const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;

function setSwitch(on) {
  if (on) document.documentElement.setAttribute(UI_V5_ATTRIBUTE, "v5");
  else document.documentElement.removeAttribute(UI_V5_ATTRIBUTE);
}

function button(label) {
  return [...document.querySelectorAll("button")].find((node) => node.textContent.trim() === label);
}

function requestPath(url) {
  return new URL(String(url), "http://localhost").pathname;
}

async function render(node) {
  await act(async () => root.render(node));
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  setSwitch(false);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
  setSwitch(false);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("provider-detail review inventory", () => {
  it("gives each surface a manifest entry with a loading or error state", () => {
    for (const [storyFile] of surfaces) {
      const surface = REVIEW_SURFACES.find((entry) => entry.source === `${storyDir}/${storyFile}`);
      expect(surface?.states?.some((state) => /loading|error/i.test(state))).toBe(true);
    }
  });

  it("associates each production source row with a loading or error scenario", () => {
    const inventoryPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../e2e/storybook-surfaces.json");
    const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
    for (const [, sourceFile, symbol] of surfaces) {
      const sourcePath = `${storyDir}/${sourceFile}`;
      const row = inventory.rows.find((entry) => entry.sourcePath === sourcePath && entry.symbol === symbol);
      expect(row?.storyScenarios?.some((scenario) => /loading|error/i.test(scenario.storyId))).toBe(true);
    }
  });
});

describe("provider-detail states", () => {
  it.each([false, true])("keeps inference status names with the switch %s", async (on) => {
    setSwitch(on);
    const cases = [
      [{}, "Inference not tested"],
      [{ testing: true }, "Inference test running"],
      [{ status: "error" }, "Inference failed in this session"],
      [{ status: "skipped" }, "Inference skipped in this session"],
    ];
    for (const [props, text] of cases) {
      await render(React.createElement(InferenceStatus, props));
      const status = host.querySelector("[role='status']");
      expect(status.textContent).toBe(text);
      expect(status.querySelector("button, a, input")).toBeNull();
    }
  });

  it.each([false, true])("keeps catalog provenance empty and error text with the switch %s", async (on) => {
    setSwitch(on);
    await render(React.createElement(ModelCatalogProvenance, {
      providerId: "openai",
      status: { enabled: false, models: [], syncedAt: null, intervalHours: null },
    }));
    expect(host.querySelector("[aria-label='Model list provenance']")).not.toBeNull();
    expect(host.textContent).toContain("Built-in registry");
    expect(host.textContent).toContain("UNKNOWN");

    await render(React.createElement(ModelCatalogProvenance, {
      providerId: "openai",
      status: { ...freshStatus, error: "discovery failed" },
    }));
    expect(host.textContent).toContain("STALE. The last discovery attempt failed; the previous snapshot is retained.");
    expect(host.textContent).toContain("Provider identity:");
  });

  it.each([false, true])("keeps the RPM label, empty value and focus ring with the switch %s", async (on) => {
    setSwitch(on);
    const save = vi.fn();
    function Field({ value }) {
      const [current, setCurrent] = useState(value);
      return React.createElement(ProviderRpmControl, {
        value: current,
        placeholder: "60",
        max: 100,
        onChange: setCurrent,
        onSave: save,
      });
    }
    await render(React.createElement(Field, { key: "empty", value: "" }));
    const label = host.querySelector("label");
    const input = host.querySelector("input");
    expect(label.textContent).toBe("RPM / account");
    expect(label.control).toBe(input);
    expect(label.className).not.toMatch(/\bhidden\b/);
    expect(input.id).toBe("provider-rpm-limit");
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("60");
    expect(input.max).toBe("100");
    expect(input.tabIndex).toBeGreaterThanOrEqual(0);
    expect(input.className).toContain("focus-visible:shadow-dd-focus");
    expect(input.className).toContain("min-h-11");
    await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(save).toHaveBeenCalledWith("");

    await render(React.createElement(Field, { key: "limit", value: "999" }));
    expect(host.querySelector("label").textContent).toBe("RPM / account");
    expect(host.querySelector("input").value).toBe("999");
    expect(host.querySelector("input").max).toBe("100");
  });

  it.each([false, true])("keeps readiness loading, empty and error requests with the switch %s", async (on) => {
    setSwitch(on);
    const calls = [];
    vi.stubGlobal("fetch", vi.fn((url, init = {}) => {
      calls.push({ path: requestPath(url), method: init.method || "GET", body: init.body ?? null });
      return new Promise(() => {});
    }));
    await render(React.createElement(NativeProviderReadiness, { providerId: "openai", connections: [] }));
    expect(host.querySelector("[aria-label='Provider readiness']").tagName).toBe("SECTION");
    expect(host.querySelector("[role='status']").textContent).toBe("Loading local readiness evidence…");
    expect(calls).toEqual([{ path: "/api/providers/openai/readiness", method: "GET", body: null }]);
    const signal = vi.mocked(fetch).mock.calls[0][1].signal;
    await act(async () => root.unmount());
    expect(signal.aborted).toBe(true);
    root = createRoot(host);

    calls.length = 0;
    vi.stubGlobal("fetch", vi.fn((url, init = {}) => {
      calls.push({ path: requestPath(url), method: init.method || "GET", body: init.body ?? null });
      return Promise.resolve(new Response(JSON.stringify({ error: "Readiness unavailable" }), { status: 503 }));
    }));
    await render(React.createElement(NativeProviderReadiness, {
      providerId: "fixture-empty",
      connections: [],
    }));
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toContain("Not listed");
    expect(host.textContent).toContain("No dedicated native route configured");
    expect(host.textContent).toContain("Saved successful credential validations: 0");
    expect(host.textContent).toContain("Readiness evidence unavailable. Catalog, dispatch, authentication and inference are unknown.");
    expect(host.querySelector("[role='status']").textContent).toContain("Readiness evidence unavailable");
    expect(calls).toEqual([{ path: "/api/providers/fixture-empty/readiness", method: "GET", body: null }]);
  });

  it.each([false, true])("keeps the auto-ping dialog keyboard contract with the switch %s", async (on) => {
    setSwitch(on);
    function Harness() {
      const [open, setOpen] = useState(false);
      return React.createElement(React.Fragment, null,
        React.createElement("button", { type: "button", onClick: () => setOpen(true) }, "Edit schedule"),
        open ? React.createElement(AutoPingScheduleModal, {
          isOpen: true,
          connection: { name: "Production" },
          schedule,
          onSave: vi.fn(),
          onClose: () => setOpen(false),
        }) : null);
    }
    await render(React.createElement(Harness));
    const opener = host.querySelector("button");
    opener.focus();
    await act(async () => opener.click());
    const dialog = document.querySelector("dialog");
    expect(dialog.querySelector("section").className).toContain("motion-reduce:animate-none");
    const named = [...dialog.querySelectorAll("button, input")].filter((node) => !node.disabled);
    expect(named.every((node) => node.tabIndex >= 0)).toBe(true);
    expect(dialog.querySelector("[aria-label='Close']")).not.toBeNull();
    expect(dialog.querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(dialog.querySelector("input[type='checkbox']").labels[0].textContent).toContain("Enable scheduled pings");
    expect(dialog.querySelector("input[type='time']").labels[0].textContent).toContain("Anchor time");
    expect(dialog.querySelector("footer").className).toContain("min-h-11");
    await act(async () => dialog.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true })));
    expect(document.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);

    await render(React.createElement(AutoPingScheduleModal, {
      key: "empty",
      isOpen: true,
      connection: { name: "Production" },
      schedule: null,
      onSave: vi.fn(),
      onClose: vi.fn(),
    }));
    expect(document.querySelector("input[type='checkbox']").checked).toBe(false);
    expect(document.querySelector("input[type='time']")).toBeNull();
    expect(button("Save").disabled).toBe(false);

    await render(React.createElement(AutoPingScheduleModal, {
      key: "invalid",
      isOpen: true,
      connection: { name: "Production" },
      schedule: { ...schedule, anchor: "bad" },
      onSave: vi.fn(),
      onClose: vi.fn(),
    }));
    expect(document.querySelector("[role='alert']").textContent).toContain("Use HH:MM");
    expect(button("Save").disabled).toBe(true);

    const onClose = vi.fn();
    const onSave = vi.fn(() => new Promise(() => {}));
    await render(React.createElement(AutoPingScheduleModal, {
      key: "pending",
      isOpen: true,
      connection: { name: "Production" },
      schedule,
      onSave,
      onClose,
    }));
    await act(async () => button("Save").click());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toEqual({
      enabled: true, anchor: "09:30", timezone: "UTC", windowHours: 5, slotsPerDay: 3,
    });
    expect(button("Saving...").disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(true);
    await act(async () => document.querySelector("dialog").dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true })));
    expect(onClose).not.toHaveBeenCalled();

    const rejected = vi.fn().mockRejectedValue(new Error("Schedule save failed"));
    const closeAfter = vi.fn();
    await render(React.createElement(AutoPingScheduleModal, {
      key: "rejected",
      isOpen: true,
      connection: { name: "Production" },
      schedule,
      onSave: rejected,
      onClose: closeAfter,
    }));
    await act(async () => button("Save").click());
    await act(async () => { await Promise.resolve(); });
    expect(rejected.mock.calls[0][0]).toEqual({
      enabled: true, anchor: "09:30", timezone: "UTC", windowHours: 5, slotsPerDay: 3,
    });
    expect(document.querySelector("[role='alert']").textContent).toContain("Schedule save failed");
    expect(button("Save").disabled).toBe(false);
    const openerStill = host.querySelector("button");
    if (openerStill) openerStill.focus();
    await act(async () => document.querySelector("[aria-label='Close']").click());
    expect(closeAfter).toHaveBeenCalledTimes(1);
  });
});
