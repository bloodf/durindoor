// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/shared/components", () => ({
  Button: ({ children, ...props }) => React.createElement("button", props, children),
  Modal: ({ isOpen, title, children }) => isOpen ? React.createElement("section", null,
    React.createElement("h2", null, title), children) : null,
}));
vi.mock("@/i18n/runtime", () => ({ translate: (text) => text }));

import BulkImportGrokCliModal from "@/app/(dashboard)/dashboard/providers/[id]/BulkImportGrokCliModal.js";

describe("BulkImportGrokCliModal", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("submits accounts JSON and reports partial results", async () => {
    const onSuccess = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: 1,
        failed: 1,
        results: [
          { index: 0, ok: true, id: "grok-1" },
          { index: 1, ok: false, error: "Missing access_token / accessToken" },
        ],
      }),
    });
    globalThis.fetch = fetchMock;

    await act(async () => {
      root.render(React.createElement(BulkImportGrokCliModal, {
        isOpen: true,
        onClose: vi.fn(),
        onSuccess,
      }));
    });

    expect(container.textContent).toContain("Bulk Add Grok CLI Accounts");
    const textarea = container.querySelector("textarea");
    await act(async () => {
      const value = JSON.stringify({ accounts: [
        { access_token: "secret" },
        { email: "invalid@example.com" },
      ] });
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const importButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Import All");
    await act(async () => {
      importButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/oauth/grok-cli/bulk-import", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ accounts: [
        { access_token: "secret" },
        { email: "invalid@example.com" },
      ] }),
    }));
    expect(container.textContent).toContain("1 added, 1 failed");
    expect(container.textContent).toContain("[1] Missing access_token / accessToken");
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("wires Grok Bulk Add beside the existing Codex controls", () => {
    const source = readFileSync(
      resolve(repoRoot, "src/app/(dashboard)/dashboard/providers/[id]/page.js"),
      "utf8",
    );
    expect(source).toContain('import BulkImportGrokCliModal from "./BulkImportGrokCliModal"');
    expect(source.match(/providerId === "grok-cli"/g).length).toBeGreaterThanOrEqual(3);
    expect(source).toContain("<BulkImportGrokCliModal");
  });
});
