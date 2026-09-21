// @vitest-environment happy-dom
/**
 * Port #4206 review findings on VisibleModelsModal:
 * - opening with no stored allowlist must default to nothing selected, not
 *   every row this load happened to see (an untouched Save would otherwise
 *   freeze today's catalog as a permanent allowlist).
 * - a failed GET of the current allowlist must disable Save, so the modal
 *   can't overwrite the stored allowlist with an incomplete view.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import VisibleModelsModal from "../../src/app/(dashboard)/dashboard/providers/[id]/VisibleModelsModal.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const render = async (element) => act(async () => root.render(element));
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

function baseProps(overrides = {}) {
  return {
    isOpen: true,
    onClose: vi.fn(),
    providerId: "cline",
    providerAlias: "cl",
    connections: [],
    customModels: [],
    disabledModelIds: [],
    onSaved: vi.fn(),
    ...overrides,
  };
}

describe("VisibleModelsModal defaults", () => {
  it("selects nothing when no allowlist is stored yet, instead of every loaded row", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("/api/models/enabled")) {
        return { ok: true, json: async () => ({ ids: [] }) };
      }
      return { ok: true, json: async () => ({ models: [] }) };
    }));

    await render(React.createElement(VisibleModelsModal, baseProps()));
    await flush();

    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    expect(checkboxes.length).toBeGreaterThan(0);
    expect(checkboxes.every((cb) => cb.checked === false)).toBe(true);
    expect(document.body.textContent).toContain("Nothing selected");
  });

  it("keeps a stored allowlist selected as-is", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("/api/models/enabled")) {
        return { ok: true, json: async () => ({ ids: ["z-ai/glm-5.3-flash"] }) };
      }
      return { ok: true, json: async () => ({ models: [] }) };
    }));

    await render(React.createElement(VisibleModelsModal, baseProps()));
    await flush();

    expect(document.body.textContent).toMatch(/1 of \d+ selected/);
  });

  it("disables Save when the current-allowlist fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("/api/models/enabled")) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({ models: [] }) };
    }));

    await render(React.createElement(VisibleModelsModal, baseProps()));
    await flush();

    const saveButton = Array.from(document.querySelectorAll("button"))
      .find((btn) => btn.textContent.trim() === "Save");
    expect(saveButton).toBeTruthy();
    expect(saveButton.disabled).toBe(true);
    expect(document.body.textContent).toContain("Could not load the current allowlist");
  });
});
