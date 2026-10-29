// @vitest-environment happy-dom
function _extends() {
  return _extends = Object.assign ? Object.assign.bind() : function(n) {
    for (var e = 1; e < arguments.length; e++) {
      var t = arguments[e];
      for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]);
    }
    return n;
  }, _extends.apply(null, arguments);
}
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReviewComboFormModal from "../../src/shared/ui/v5/combos/ReviewComboFormModal.jsx";
import ReviewSharedComboFormModal from "../../src/shared/ui/v5/combos/ReviewSharedComboFormModal.jsx";
import ReviewCombosPage from "../../src/shared/ui/v5/combos/ReviewCombosPage.jsx";
import ReviewModelSelectModal from "../../src/shared/ui/v5/combos/ReviewModelSelectModal.jsx";
import { installStoryNetwork } from "../../.storybook/network.js";
import { createRoutingFixture } from "../../src/shared/ui/v5/preservation/routing-fixtures.js";
import { modelCapabilities, splitModelIdentity } from "../../src/shared/ui/v5/combos/model.js";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, container, cleanup;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container?.remove();
  await cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
function setup(options) {
  const fixture = createRoutingFixture(options);
  cleanup = installStoryNetwork({
    routes: fixture.routes
  });
  return fixture;
}
async function mount(component) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(component));
}
async function click(label, scope = document) {
  const element = [...scope.querySelectorAll("button")].find((node) => node.getAttribute("aria-label") === label || node.textContent.trim() === label || node.textContent.replace(/delete|file_copy/g, "").trim() === label);
  expect(element, label).toBeTruthy();
  await act(async () => element.click());
}
async function fill(input, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", {
      bubbles: true
    }));
  });
}
const combo = {
  id: "review-combo",
  name: "review-route",
  models: ["openai/gpt-4o", "anthropic/claude-sonnet-4.5"],
  members: [{
    id: "openai/gpt-4o",
    weight: 2
  }, {
    id: "anthropic/claude-sonnet-4.5",
    weight: 7
  }],
  capabilities: {
    pdf: false,
    contextWindow: 32e3
  },
  allowedConnectionIds: ["review-account"]
};
describe("combo redesign preserves domain workflows", () => {
  it("keeps weight focus while showing and clearing validation feedback", async () => {
    setup();
    await mount(React.createElement(ReviewComboFormModal, { isOpen: true, combo, activeProviders: [], onClose() {}, onSave: vi.fn() }));
    const input = document.querySelector('input[aria-label="Weight"]');
    input.focus();
    await fill(input, "");
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby")).textContent).toBe("Use a positive weight");
    await fill(input, "3");
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });
  it("uses readable capacity labels and preserves exact full model identities", () => {
    expect(modelCapabilities({
      pdf: true,
      audioInput: true,
      tools: false
    })).toEqual(["PDF reading", "audio input"]);
    expect(splitModelIdentity("openai/family/model")).toEqual({
      provider: "openai",
      model: "family/model",
      value: "openai/family/model"
    });
    expect(splitModelIdentity("nested-route", true).provider).toBe("Combo");
  });
  it("saves manual ordering, original member weights and capability ceilings together", async () => {
    setup();
    const save = vi.fn(async () => ({
      ok: true
    }));
    await mount(React.createElement(ReviewComboFormModal, {
      isOpen: true,
      combo,
      activeProviders: [],
      onClose: () => {
      },
      onSave: save
    }));
    await click("Move down");
    await click("Save");
    expect(save).toHaveBeenCalledWith({
      name: "review-route",
      models: ["anthropic/claude-sonnet-4.5", "openai/gpt-4o"],
      members: [{
        id: "anthropic/claude-sonnet-4.5",
        weight: 7
      }, {
        id: "openai/gpt-4o",
        weight: 2
      }],
      capabilities: combo.capabilities
    });
  });
  it("keeps an unsuccessful save open and clears pending after a thrown failure", async () => {
    setup();
    const save = vi.fn().mockRejectedValue(new Error("Synthetic save failure"));
    await mount(React.createElement(ReviewComboFormModal, {
      isOpen: true,
      combo,
      activeProviders: [],
      onClose: () => {
      },
      onSave: save
    }));
    await click("Save");
    expect(document.querySelector('[role="alert"]').textContent).toBe("Synthetic save failure");
    expect([...document.querySelectorAll("button")].find((node) => node.textContent === "Save").disabled).toBe(false);
    expect(document.querySelector("dialog")).toBeTruthy();
  });
  it("does not call Save after cancellation", async () => {
    setup();
    const save = vi.fn();
    const close = vi.fn();
    await mount(React.createElement(ReviewComboFormModal, {
      isOpen: true,
      combo,
      activeProviders: [],
      onClose: close,
      onSave: save
    }));
    await click("Cancel");
    expect(close).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
  });
  it("retains the shared form prefix and original payload without member fields", async () => {
    setup();
    const save = vi.fn(async () => {
    });
    await mount(React.createElement(ReviewSharedComboFormModal, {
      isOpen: true,
      combo: {
        ...combo,
        name: "claude-review-route"
      },
      forcePrefix: "claude-",
      activeProviders: [],
      onClose: () => {
      },
      onSave: save
    }));
    await click("Move anthropic/claude-sonnet-4.5 up");
    await click("Save");
    expect(save.mock.calls[0][0]).toMatchObject({
      name: "claude-review-route",
      models: ["anthropic/claude-sonnet-4.5", "openai/gpt-4o"],
      capabilities: combo.capabilities
    });
    expect(save.mock.calls[0][0]).not.toHaveProperty("members");
  });
  it("refreshes weight drafts when a different combo opens", async () => {
    setup();
    const save = vi.fn(async () => ({
      ok: true
    }));
    const props = {
      isOpen: true,
      activeProviders: [],
      onClose() {
      },
      onSave: save
    };
    await mount(React.createElement(ReviewComboFormModal, _extends({}, props, {
      combo
    })));
    await act(async () => root.render(React.createElement(ReviewComboFormModal, _extends({}, props, {
      combo: {
        ...combo,
        id: "other",
        name: "other-route",
        members: [{
          id: "openai/gpt-4o",
          weight: 9
        }]
      }
    }))));
    await click("Save");
    expect(save.mock.calls[0][0].members[0].weight).toBe(9);
  });
  it("retains strategy after a rejected update and gives recovery feedback", async () => {
    const failures = { "PATCH /api/settings": "Routing strategy could not be saved" };
    const fixture = setup({ failures });
    await mount(React.createElement(ReviewCombosPage, null));
    const input = document.querySelector('input[aria-label="Timeout for review-route"]');
    expect(input).toBeTruthy();
    await fill(input, "9");
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(document.querySelector('[role="alert"]').textContent).toContain("could not be saved");
    expect(input.value).toBe("9");
    expect(fixture.snapshot().settings.comboStrategies["review-route"].timeoutMs).toBe(12e3);
    delete failures["PATCH /api/settings"];
    await act(async () => [...document.querySelectorAll("button")].find((button) => button.textContent.trim().endsWith("Retry")).click());
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(input.value).toBe("9");
    expect(fixture.snapshot().settings.comboStrategies["review-route"].timeoutMs).toBe(9000);
  });
  it("keeps failed bulk deletes visible and removes strategy only for successful deletes", async () => {
    const fixture = setup({
      combos: [combo, {
        ...combo,
        id: "review-second",
        name: "second-route"
      }],
      failures: {
        "DELETE /api/combos/review-second": "Synthetic delete failure"
      },
      settings: {
        comboStrategies: {
          "review-route": {
            fallbackStrategy: "weighted"
          },
          "second-route": {
            fallbackStrategy: "smart"
          }
        }
      }
    });
    await mount(React.createElement(ReviewCombosPage, null));
    const selectAll = [...document.querySelectorAll("label")].find((node) => node.textContent.includes("Select all"));
    await act(async () => selectAll.querySelector("input").click());
    await click("Delete (2)");
    await click("Delete", document.querySelector("dialog"));
    expect(fixture.snapshot().combos.map((item) => item.name)).toEqual(["second-route"]);
    expect(fixture.snapshot().settings.comboStrategies).toEqual({
      "second-route": {
        fallbackStrategy: "smart"
      }
    });
    expect(document.body.textContent).toContain("They remain in the list");
    expect(document.body.textContent).toContain("second-route");
  });
  it("keeps rejected deletion open with visible dialog feedback and retries successfully", async () => {
    const fixture = createRoutingFixture();
    let attempts = 0;
    const deleteRoute = fixture.routes["DELETE /api/combos/review-combo"];
    fixture.routes["DELETE /api/combos/review-combo"] = async (request) => ++attempts === 1 ? { status: 503, body: { error: "Synthetic unavailable" } } : deleteRoute(request);
    cleanup = installStoryNetwork({ routes: fixture.routes });
    await mount(React.createElement(ReviewCombosPage));
    const row = document.querySelector(".v5-combo-row");
    await click("Delete", row);
    await click("Confirm", document.querySelector("dialog"));
    const dialog = document.querySelector("dialog");
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('[role="alert"]').textContent).toContain("Could not delete combo");
    expect(fixture.snapshot().combos).toHaveLength(1);
    await click("Confirm", dialog);
    expect(fixture.snapshot().combos).toHaveLength(0);
    expect(document.querySelector("dialog")).toBeNull();
  });
  it("counts an existing single-select model without requiring multi-select members", async () => {
    setup();
    await mount(React.createElement(ReviewModelSelectModal, { isOpen: true, onClose() {}, onSelect() {}, selectedModel: "openai/gpt-4o", activeProviders: [{ provider: "openai", id: "review-account", isActive: true }] }));
    expect(document.querySelector("dialog footer [role=status]").textContent).toBe("1 selected");
    const checked = document.querySelector('.v5-model-picker-row[aria-pressed=true]');
    expect(checked.querySelector(".v5-model-check .v5-motion-icon")).toBeTruthy();
  });
  it("copies routing restrictions, weights and strategy when duplicating", async () => {
    const fixture = setup({
      combos: [combo]
    });
    await mount(React.createElement(ReviewCombosPage, null));
    await click("Duplicate combo");
    expect(fixture.snapshot().combos[1]).toMatchObject({
      name: "review-route-copy",
      models: combo.models,
      members: combo.members,
      allowedConnectionIds: combo.allowedConnectionIds,
      capabilities: combo.capabilities
    });
    expect(fixture.snapshot().settings.comboStrategies["review-route-copy"]).toEqual(fixture.snapshot().settings.comboStrategies["review-route"]);
  });
  it("searches provider names as well as model IDs and keeps nested combos selectable", async () => {
    setup();
    const select = vi.fn();
    await mount(React.createElement(ReviewModelSelectModal, {
      isOpen: true,
      onClose: () => {
      },
      onSelect: select,
      activeProviders: [{
        provider: "openai",
        id: "review-account",
        isActive: true
      }]
    }));
    const input = document.querySelector('input[aria-label="Search models"]');
    await fill(input, "openai");
    expect(document.querySelector('section[aria-label="OpenAI"] .v5-model-picker-row')).toBeTruthy();
    await fill(input, "review-route");
    const row = [...document.querySelectorAll(".v5-model-picker-row")].find((node) => node.textContent.includes("review-route"));
    expect(row).toBeTruthy();
    await act(async () => row.click());
    expect(select).toHaveBeenCalledWith({
      id: "review-route",
      name: "review-route",
      value: "review-route"
    });
  });

  it("names every capability checkbox with its human-readable feature", async () => {
    setup();
    await mount(React.createElement(ReviewComboFormModal, { isOpen: true, combo, activeProviders: [], onClose() {}, onSave() {} }));
    const names = [...document.querySelectorAll('.v5-combo-capabilities input[type="checkbox"]')].map((input) => input.getAttribute("aria-label"));
    expect(names).toEqual(["Disable vision", "Disable PDF reading", "Disable audio input", "Disable video input", "Disable image output", "Disable audio output", "Disable video output", "Disable web search", "Disable tool calls", "Disable reasoning"]);
    const pdf = [...document.querySelectorAll('input[type="checkbox"]')].find((input) => input.getAttribute("aria-label") === "Disable PDF reading");
    expect(pdf.checked).toBe(true);
    await act(async () => pdf.click());
    expect(pdf.checked).toBe(false);
  });

  it.each(["", "0", "-2"])("blocks the invalid weight %j, reports its field error and recovers to a saved valid weight", async (value) => {
    setup();
    const save = vi.fn(async () => ({ ok: true }));
    await mount(React.createElement(ReviewComboFormModal, { isOpen: true, combo, activeProviders: [], onClose() {}, onSave: save }));
    await fill(document.querySelector('input[aria-label="Weight"]'), value);
    const weight = document.querySelector('input[aria-label="Weight"]');
    const submit = document.querySelector("dialog footer button:last-child");
    expect(submit.disabled).toBe(true);
    expect(weight.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(weight.getAttribute("aria-describedby")).textContent).toContain("positive weight");
    await act(async () => submit.click());
    expect(save).not.toHaveBeenCalled();
    await fill(weight, "3.5");
    expect(submit.disabled).toBe(false);
    expect(document.querySelector('input[aria-label="Weight"]').hasAttribute("aria-invalid")).toBe(false);
    await click("Save");
    expect(save.mock.calls[0][0].members).toEqual([{ id: "openai/gpt-4o", weight: 3.5 }, { id: "anthropic/claude-sonnet-4.5", weight: 7 }]);
  });

  it("rejects a non-finite persisted weight until the user corrects it", async () => {
    setup();
    const save = vi.fn(async () => ({ ok: true }));
    await mount(React.createElement(ReviewComboFormModal, { isOpen: true, combo: { ...combo, members: [{ id: "openai/gpt-4o", weight: Infinity }] }, activeProviders: [], onClose() {}, onSave: save }));
    const weight = document.querySelector('input[aria-label="Weight"]');
    expect(document.querySelector("dialog footer button:last-child").disabled).toBe(true);
    expect(weight.getAttribute("aria-invalid")).toBe("true");
    await fill(weight, "4");
    await click("Save");
    expect(save.mock.calls[0][0].members[0]).toEqual({ id: "openai/gpt-4o", weight: 4 });
  });

  it.each(["Context window", "Max output"])("validates %s as a positive safe integer, then saves corrected and blank values", async (label) => {
    setup();
    const save = vi.fn(async () => ({ ok: true }));
    await mount(React.createElement(ReviewComboFormModal, { isOpen: true, combo, activeProviders: [], onClose() {}, onSave: save }));
    const fieldLabel = [...document.querySelectorAll("label[for]")].find((node) => node.textContent === label);
    const input = document.getElementById(fieldLabel.htmlFor);
    const submit = document.querySelector("dialog footer button:last-child");
    for (const value of ["0", "-1", "1.5", "9007199254740992"]) {
      await fill(input, value);
      expect(submit.disabled, value).toBe(true);
      expect(input.getAttribute("aria-invalid"), value).toBe("true");
      expect(document.getElementById(input.getAttribute("aria-describedby")).textContent).toContain("positive whole number");
    }
    const key = label === "Context window" ? "contextWindow" : "maxOutput";
    await fill(input, "64000");
    expect(submit.disabled).toBe(false);
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    await click("Save");
    expect(save.mock.calls[0][0].capabilities[key]).toBe(64000);
    await fill(input, "");
    expect(submit.disabled).toBe(false);
    await click("Save");
    expect(JSON.parse(JSON.stringify(save.mock.calls[1][0])).capabilities).not.toHaveProperty(key);
  });

  it("keeps form actions outside the independently scrolling modal body", async () => {
    setup();
    await mount(React.createElement(ReviewComboFormModal, { isOpen: true, combo, activeProviders: [], onClose() {}, onSave() {} }));
    const surface = document.querySelector("dialog > .v5-combo-form");
    const scrollBody = [...surface.children].find((node) => node.classList.contains("overflow-y-auto"));
    const footer = surface.querySelector(":scope > footer");
    expect(scrollBody).toBeTruthy();
    expect(footer).toBeTruthy();
    expect(scrollBody.contains(footer)).toBe(false);
    expect([...footer.querySelectorAll("button")].map((button) => button.textContent.trim())).toEqual(["Cancel", "Save"]);
    expect(scrollBody.querySelector('input[aria-label="Weight"]')).toBeTruthy();
  });
});
