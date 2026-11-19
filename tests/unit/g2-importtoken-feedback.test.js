// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { within } from "@testing-library/dom";
import ImportTokenModal from "@/shared/components/ImportTokenModal.js";

let root;
let host;
const fixtureToken = "inert-import-retry-fixture";
const button = (dialog, label) => within(dialog).getByRole("button", { name: label, exact: true });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // This shim supports DOM mounting, not native dialog qualification.
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () {
    this.setAttribute("open", "");
  });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function () {
    this.removeAttribute("open");
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ImportTokenModal private retry feedback", () => {
  it.each(["response", "network", "json"])("keeps retry state private after %s failure", async (failure) => {
    let resolveImport;
    let rejectImport;
    const fetch = vi.fn(() => new Promise((resolve, reject) => {
      resolveImport = resolve;
      rejectImport = reject;
    }));
    vi.stubGlobal("fetch", fetch);
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    const render = (isOpen) => act(async () => root.render(React.createElement(ImportTokenModal, {
      isOpen, provider: "fixture", providerInfo: { name: "Fixture" }, onSuccess, onClose,
    })));
    await render(true);
    const dialog = document.body.querySelector("dialog");
    const input = dialog.querySelector("input");
    expect(input.type).toBe("password");
    expect(input.autocomplete).toBe("off");
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, fixtureToken);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const connect = button(dialog, "Connect");
    await act(async () => connect.click());
    expect(connect.disabled).toBe(true);
    await act(async () => connect.click());
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      const message = `Rejected ${fixtureToken}`;
      if (failure === "network") rejectImport(new Error(message));
      else resolveImport({ ok: false, json: async () => {
        if (failure === "json") throw new Error(message);
        return { error: message };
      } });
    });
    // Base source echoes the credential-bearing error here. The fixed source uses this literal.
    expect(dialog.textContent).toContain("Import failed. Please try again.");
    expect(dialog.textContent).not.toContain(fixtureToken);
    expect(dialog.querySelector('[role="alert"]').textContent).toBe("Import failed. Please try again.");
    expect(input.value).toBe(fixtureToken);
    expect(connect.disabled).toBe(false);
    expect(dialog.open).toBe(true);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    // A retry reuses only the private input state and succeeds only on an OK response.
    await act(async () => connect.click());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]).toEqual(["/api/oauth/fixture/import-token", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: fixtureToken }),
    }]);
    await act(async () => resolveImport({ ok: true, json: async () => ({}) }));
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    await render(false);
    await render(true);
    expect(document.body.querySelector("dialog input").value).toBe("");
  });
});
