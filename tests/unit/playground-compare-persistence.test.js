// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PlaygroundCompare from "../../src/app/(dashboard)/dashboard/playground/PlaygroundCompare.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const key = "durindoor.playground.compare.selections.v1";
const models = [
  { id: "codex/a", requestModel: "codex/a", name: "Alpha", providerId: "codex", providerName: "Codex" },
  { id: "codex/b", requestModel: "codex/b", name: "Bravo", providerId: "codex", providerName: "Codex" },
];
const providerGroups = [{ providerId: "codex", connections: [{ id: "c1", name: "First account" }, { id: "c2", name: "Second account" }] }];
let root;
let container;

function mount(fetchImpl) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(React.createElement(PlaygroundCompare, { modelOptions: models, providerGroups, content: "private prompt", fetchImpl })));
}

function unmount() {
  if (root) act(() => root.unmount());
  root = null;
  container?.remove();
}

afterEach(() => {
  unmount();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

it("restores selectors before writing and retains them on a Compare mode remount without dispatch", () => {
  const saved = [{ modelId: "codex/b", connectionId: "c2" }, { modelId: "codex/a", connectionId: "auto" }];
  sessionStorage.setItem(key, JSON.stringify(saved));
  const writes = vi.spyOn(sessionStorage, "setItem");
  const fetchImpl = vi.fn();
  mount(fetchImpl);

  expect(container.querySelector('[aria-label="Model for column 1"]').textContent).toContain("Bravo");
  expect(container.querySelector('[aria-label="Connection for column 1"]').textContent).toContain("Second account");
  expect(writes).toHaveBeenCalled();
  // An initial default-state write would destroy the saved model/account choice.
  for (const [writtenKey, value] of writes.mock.calls) {
    expect(writtenKey).toBe(key);
    expect(JSON.parse(value)).toEqual(saved);
  }

  act(() => [...container.querySelectorAll("button")].find((button) => button.textContent.includes("Add model")).click());
  const expected = [...saved, { modelId: "codex/a", connectionId: "auto" }];
  expect(JSON.parse(sessionStorage.getItem(key))).toEqual(expected);
  unmount();
  mount(fetchImpl);

  expect(container.querySelectorAll('[role="region"]')).toHaveLength(3);
  expect(container.querySelector('[aria-label="Model for column 1"]').textContent).toContain("Bravo");
  expect(container.querySelector('[aria-label="Connection for column 1"]').textContent).toContain("Second account");
  expect(container.textContent.match(/Unknown/g)).toHaveLength(3);
  expect(JSON.parse(sessionStorage.getItem(key))).toEqual(expected);
  expect(fetchImpl).not.toHaveBeenCalled();
});
