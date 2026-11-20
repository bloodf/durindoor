// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ModelsCard from "@/app/(dashboard)/dashboard/providers/components/ModelsCard.js";

let root;
let host;
const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;
const button = (scope, label) => [...scope.querySelectorAll("button")]
  .find((node) => node.textContent.trim().endsWith(label));

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // DOM-only shim; native focus, dismissal and WCAG behavior require browser gates.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
  vi.unstubAllGlobals();
});

it.each(["http", "network"])("preserves the custom row and confirmation after %s delete failure, then retries", async (failure) => {
  let models = [{ id: "fixture-model", providerAlias: "fixture", type: "embedding" }];
  let resolveDelete;
  let rejectDelete;
  const fetch = vi.fn((url, options = {}) => {
    if (options.method === "DELETE") return new Promise((resolve, reject) => {
      resolveDelete = resolve;
      rejectDelete = reject;
    });
    if (url === "/api/models/alias") return Promise.resolve({ ok: true, json: async () => ({ aliases: {} }) });
    if (url === "/api/providers") return Promise.resolve({ ok: true, json: async () => ({ connections: [] }) });
    if (url === "/api/models/custom") return Promise.resolve({ ok: true, json: async () => ({ models }) });
    throw new Error(`Unexpected fixture request: ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(React.createElement(ModelsCard, {
    providerId: "fixture-provider", providerAliasOverride: "fixture", kindFilter: "embedding",
  })));
  const row = [...host.querySelectorAll("code")].find((node) => node.textContent === "fixture/fixture-model").closest("div.group");
  await act(async () => row.querySelector('input[type="checkbox"]').click());
  await act(async () => button(host, "Delete Selected (1)").click());
  const dialog = document.body.querySelector("dialog[open]");
  expect(dialog.textContent).toContain("Delete 1 custom model(s)?");
  await act(async () => button(dialog, "Confirm").click());
  expect(button(dialog, "Cancel").disabled).toBe(true);
  expect(button(dialog, "Confirm").disabled).toBe(true);
  await act(async () => button(dialog, "Confirm").click());
  expect(fetch.mock.calls.filter(([, options]) => options?.method === "DELETE")).toHaveLength(1);
  await act(async () => {
    if (failure === "network") rejectDelete(new Error("Fixture offline"));
    else resolveDelete({ ok: false });
  });
  // Literal assertions fail on the preserved base: it closes before DELETE settles.
  expect(dialog.open).toBe(true);
  expect(host.textContent).toContain("fixture/fixture-model");
  expect(row.querySelector('input[type="checkbox"]').checked).toBe(true);
  expect(dialog.querySelector('[role="alert"]').textContent).toBe("Could not delete custom models. Try again.");
  expect(button(dialog, "Confirm").disabled).toBe(false);
  expect(button(dialog, "Cancel").disabled).toBe(false);
  await act(async () => button(dialog, "Confirm").click());
  const deletes = fetch.mock.calls.filter(([, options]) => options?.method === "DELETE");
  expect(deletes).toHaveLength(2);
  expect(deletes[1][0]).toBe("/api/models/custom?providerAlias=fixture&id=fixture-model&type=embedding");
  await act(async () => {
    models = [];
    resolveDelete({ ok: true });
  });
  expect(document.body.querySelector("dialog[open]")).toBeNull();
  expect(host.textContent).not.toContain("fixture/fixture-model");
});


it("does not retry an acknowledged deletion when the refresh fails", async () => {
  const models = [{ id: "A", providerAlias: "fixture", type: "embedding" }, { id: "B", providerAlias: "fixture", type: "embedding" }];
  let loads = 0;
  let bDeletes = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  const fetchMock = vi.fn(async (url, options = {}) => {
    if (options.method === "DELETE") return { ok: !url.includes("id=B") || ++bDeletes > 1 };
    if (url === "/api/models/alias") return { ok: true, json: async () => ({ aliases: {} }) };
    if (url === "/api/providers") return { ok: true, json: async () => ({ connections: [] }) };
    if (url === "/api/models/custom") {
      if (++loads > 1) throw new Error("Refresh unavailable");
      return { ok: true, json: async () => ({ models }) };
    }
    throw new Error(`Unexpected fixture request ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => root.render(React.createElement(ModelsCard, { providerId: "fixture-provider", providerAliasOverride: "fixture", kindFilter: "embedding" })));
  for (const id of ["A", "B"]) {
    const row = [...host.querySelectorAll("code")].find((node) => node.textContent === `fixture/${id}`).closest("div.group");
    await act(async () => row.querySelector('input[type="checkbox"]').click());
  }
  await act(async () => button(host, "Delete Selected (2)").click());
  const dialog = document.body.querySelector("dialog[open]");
  await act(async () => button(dialog, "Confirm").click());
  expect(host.textContent).not.toContain("fixture/A");
  expect(host.textContent).toContain("fixture/B");
  const rowB = [...host.querySelectorAll("code")].find((node) => node.textContent === "fixture/B").closest("div.group");
  expect(rowB.querySelector('input[type="checkbox"]').checked).toBe(true);
  expect(dialog.querySelector('[role="alert"]').textContent).toBe("Could not delete custom models. Try again.");
  await act(async () => button(dialog, "Confirm").click());
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "DELETE").map(([url]) => new URL(url, "https://fixture.invalid").searchParams.get("id"))).toEqual(["A", "B", "B"]);
  expect(host.textContent).not.toContain("fixture/B");
  expect(document.body.querySelector("dialog[open]")).toBeNull();
  vi.restoreAllMocks();
});
