// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import ModelsCard from "@/app/(dashboard)/dashboard/providers/components/ModelsCard.js";
import { persistModelTestResults } from "@/shared/utils/modelTestResults.js";
vi.mock("@/shared/constants/models", async (load) => ({ ...await load(), getModelsByProviderId: () => [], getModelKind: (m) => m.type }));
vi.mock("@/shared/constants/providers", async (load) => ({ ...await load(), getProviderAlias: (p) => p, getProviderModelsFetcher: () => null }));
vi.mock("@/shared/utils/modelTestResults.js", async (load) => ({ ...await load(), loadModelTestResults: async () => ({}), persistModelTestResults: vi.fn() }));
let root, host, connection, models, pending;
const props = { providerId: "p", providerAliasOverride: "alias", kindFilter: "embedding" };
const response = (data) => ({ ok: true, json: async () => data });
async function render(overrides = {}) { await act(async () => root.render(React.createElement(ModelsCard, { ...props, ...overrides }))); }
async function click(label) { await act(async () => host.querySelector(`[aria-label="${label}"]`).click()); }
async function finish(data) { await act(async () => pending(response(data))); }
const error = () => host.querySelector('[role="status"]').textContent;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  connection = "c1";
  models = ["a", "b"].map((id) => ({ id, providerAlias: "alias", type: "embedding" }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    if (url === "/api/models/test") return new Promise((resolve) => { pending = resolve; });
    if (options.method === "DELETE") return response({});
    if (url === "/api/models/alias") return response({ aliases: {} });
    if (url === "/api/providers") return response({ connections: [{ id: connection, provider: "p" }] });
    if (url === "/api/models/custom") return response({ models });
    throw new Error(`Unexpected fixture fetch: ${url}`);
  }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });
it("clears an individual success and preserves another model failure", async () => {
  await render(); await click("Test a"); await finish({ error: "failure a" });
  await click("Test b"); await finish({ error: "failure b" });
  await click("Test a"); await finish({ ok: true });
  expect(error()).not.toContain("failure a"); expect(error()).toContain("failure b");
});
it.each([ ["alias", { providerAliasOverride: "new" }], ["provider", { providerId: "other" }], ["kind", { kindFilter: "image" }] ])("retires errors and a late completion after %s changes and return", async (_label, change) => {
  await render(); await click("Test a"); await finish({ error: "old failure" });
  await click("Test a"); const old = pending;
  await render(change); expect(error()).toBe(""); await render();
  await act(async () => old(response({ error: "late failure" })));
  expect(error()).toBe(""); expect(persistModelTestResults).toHaveBeenCalledTimes(1);
});
it.each(["connection", "removal"])("retires errors and late responses on %s refresh", async (change) => {
  await render(); await click("Test a"); await finish({ error: "old failure" });
  await click("Test a"); const old = pending;
  if (change === "connection") connection = "c2";
  else models = models.filter((m) => m.id !== "a");
  // Deleting b performs the same inventory refresh used by custom-model edits.
  await click("Remove custom model b");
  expect(error()).toBe("");
  await act(async () => old(response({ error: "late failure" })));
  expect(error()).toBe(""); expect(persistModelTestResults).toHaveBeenCalledTimes(1);
});
it("bulk success clears the matching single-probe failure", async () => {
  await render(); await click("Test a"); await finish({ error: "old failure" });
  const row = [...host.querySelectorAll("code")].find((n) => n.textContent === "alias/a").closest("div.group");
  await act(async () => row.querySelector('input[type="checkbox"]').click());
  const original = fetch;
  vi.stubGlobal("fetch", vi.fn((url, options) => url === "/api/models/test/batch" ? Promise.resolve({ ok: true, body: new ReadableStream({ start(c) {
    c.enqueue(new TextEncoder().encode('data: {"model":"alias/a","ok":true}\n\ndata: {"done":true}\n\n')); c.close();
  } }) }) : original(url, options)));
  await act(async () => [...host.querySelectorAll("button")].find((n) => n.textContent.includes("Test Selected")).click());
  expect(error()).toBe("");
});
it("ignores late bulk events after an account refresh", async () => {
  await render();
  const row = [...host.querySelectorAll("code")].find((n) => n.textContent === "alias/a").closest("div.group");
  await act(async () => row.querySelector('input[type="checkbox"]').click());
  let stream;
  const original = fetch;
  vi.stubGlobal("fetch", vi.fn((url, options) => url === "/api/models/test/batch" ? Promise.resolve({ ok: true, body: new ReadableStream({ start(c) { stream = c; } }) }) : original(url, options)));
  await act(async () => [...host.querySelectorAll("button")].find((n) => n.textContent.includes("Test Selected")).click());
  connection = "c2"; await click("Remove custom model b");
  await act(async () => { stream.enqueue(new TextEncoder().encode('data: {"model":"alias/a","error":"late bulk failure"}\n\n')); stream.close(); });
  expect(error()).toBe("");
  expect(persistModelTestResults.mock.calls.every(([results]) => Object.keys(results).length === 0)).toBe(true);
});
it.each(["connection", "removal"])("rejects a first late single response after %s and return", async (change) => {
  await render(); await click("Test a"); const old = pending;
  if (change === "connection") connection = "c2";
  else models = models.filter((m) => m.id !== "a");
  await click("Remove custom model b");
  connection = "c1";
  models = ["a", "b"].map((id) => ({ id, providerAlias: "alias", type: "embedding" }));
  await click("Remove custom model b");
  await act(async () => old(response({ error: "late failure" })));
  expect(error()).toBe(""); expect(persistModelTestResults).not.toHaveBeenCalled();
  expect(host.querySelector('[aria-label="Test a"]').disabled).toBe(false);
});
