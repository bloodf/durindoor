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

describe("VisibleModelsModal round-3 review fixes", () => {
  const saveButton = () => Array.from(document.querySelectorAll("button"))
    .find((btn) => btn.textContent.trim() === "Save");

  it("locks Save while a refetch for a new provider is in flight", async () => {
    let pending = false;
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("/api/models/enabled")) {
        if (pending) return new Promise(() => {});
        return { ok: true, json: async () => ({ ids: [] }) };
      }
      return { ok: true, json: async () => ({ models: [] }) };
    }));

    await render(React.createElement(VisibleModelsModal, baseProps()));
    await flush();
    expect(saveButton().disabled).toBe(false);

    pending = true;
    await render(React.createElement(VisibleModelsModal, baseProps({ providerId: "deepseek", providerAlias: "ds" })));
    await flush();
    expect(saveButton().disabled).toBe(true);
  });

  it("lists non-LLM registry models so a save cannot drop them", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("/api/models/enabled")) return { ok: true, json: async () => ({ ids: [] }) };
      return { ok: true, json: async () => ({ models: [] }) };
    }));

    await render(React.createElement(VisibleModelsModal, baseProps({ providerId: "openai", providerAlias: "openai" })));
    await flush();

    const ids = Array.from(document.querySelectorAll("label code")).map((el) => el.textContent);
    expect(ids).toEqual(expect.arrayContaining(["dall-e-3", "text-embedding-3-small", "tts-1", "whisper-1"]));
  });

  it("shows custom models stored under the registry alias as always exposed", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("/api/models/enabled")) return { ok: true, json: async () => ({ ids: [] }) };
      return { ok: true, json: async () => ({ models: [] }) };
    }));

    await render(React.createElement(VisibleModelsModal, baseProps({
      providerId: "deepseek",
      providerAlias: "ds",
      customModels: [{ providerAlias: "deepseek", id: "my-deepseek-custom" }],
    })));
    await flush();

    expect(document.body.textContent).toContain("Always exposed");
    expect(document.body.textContent).toContain("my-deepseek-custom");
  });
});
