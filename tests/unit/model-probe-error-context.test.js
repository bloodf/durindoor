// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import useModelProbeErrors from "../../src/app/(dashboard)/dashboard/providers/[id]/hooks/useModelProbeErrors.js";
import { testAndDisableFailedModels } from "../../src/shared/utils/providerModelBulkActions.js";

let root, node, current;
function Harness({ provider = "p", connection = "c1", models = ["a", "b"] }) {
  current = useModelProbeErrors(provider, connection, models);
  return React.createElement("p", null, current.error);
}
async function render(props = {}) { await act(async () => root.render(React.createElement(Harness, props))); }
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

it("bulk passes clear only their matching failures", async () => {
  await render();
  await act(async () => { current.recordError("a", "old failure"); current.recordError("b", "keep failure"); });
  const disableModels = vi.fn();
  await act(async () => {
    await testAndDisableFailedModels({ modelIds: ["a"], delayMs: 0, disableModels,
      testModel: async (id) => { current.recordError(id, null); return "ok"; } });
  });
  expect(node.textContent).toBe("p/b (c1): keep failure");
  expect(disableModels).not.toHaveBeenCalled();
});

it.each([
  ["connection", { connection: "c2" }],
  ["provider", { provider: "other" }],
  ["model removal", { models: ["b"] }],
])("retires errors and late completions on %s changes", async (_label, props) => {
  await render();
  const lateCompletion = current.recordError;
  await act(async () => current.recordError("a", "old failure"));
  expect(node.textContent).toContain("old failure");
  await render(props);
  expect(node.textContent).toBe("");
  await act(async () => lateCompletion("a", "late failure"));
  expect(node.textContent).toBe("");
  await render();
  expect(node.textContent).toBe("");
});

it("preserves errors on a same-context inventory refresh and clears individual success", async () => {
  await render();
  await act(async () => current.recordError("a", "failure"));
  await render({ models: ["b", "a", "new"] });
  expect(node.textContent).toBe("p/a (c1): failure");
  await act(async () => current.recordError("a", null));
  expect(node.textContent).toBe("");
});

it("rejects an old account completion after navigating away and back", async () => {
  await render();
  const lateCompletion = current.recordError;
  await render({ connection: "c2" });
  await render();
  await act(async () => lateCompletion("a", "retired failure"));
  expect(node.textContent).toBe("");
});

it("rejects a removed model's old completion even after the model is added back", async () => {
  await render();
  const lateCompletion = current.recordError;
  await render({ models: ["b"] });
  await render();
  await act(async () => lateCompletion("a", "retired failure"));
  expect(node.textContent).toBe("");
  await act(async () => current.recordError("a", "current failure"));
  expect(node.textContent).toContain("current failure");
});
