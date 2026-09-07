// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Footer from "../../src/shared/components/Footer.js";
import ChangelogModal from "../../src/shared/components/ChangelogModal.js";
import UpdatePanel from "../../src/shared/components/UpdatePanel.js";
import { APP_CONFIG, GITHUB_CONFIG } from "../../src/shared/constants/config";

/** Behavioral contracts: rendered footer regions, changelog loading/close,
 * and auto-update failure transition to manual install. */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;
const roots = [];
let originalFetch;
let originalShowModal;
let originalClose;

beforeAll(() => {
  originalFetch = globalThis.fetch;
  originalShowModal = HTMLDialogElement.prototype.showModal;
  originalClose = HTMLDialogElement.prototype.close;
});

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});

function render(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push([root, container]);
  act(() => root.render(element));
  return { container, update: (next) => act(() => root.render(next)) };
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

afterEach(() => {
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  while (roots.length) {
    const [root, container] = roots.pop();
    act(() => root.unmount());
    container.remove();
  }
  document.body.replaceChildren();
});

describe("shared support production surfaces", () => {
  it("renders footer brand, link groups, legal links, and accessible social controls", () => {
    const { container } = render(h(Footer));
    expect(container.querySelector("footer").textContent).toContain(APP_CONFIG.name);
    expect(container.querySelectorAll("h2")).toHaveLength(3);
    expect(container.querySelector("a[aria-label='Twitter']")).not.toBeNull();
    expect(container.querySelector("a[aria-label='GitHub']")).not.toBeNull();
    expect([...container.querySelectorAll("a")].map((link) => link.textContent)).toContain("Privacy Policy");
  });

  it("fetches changelog with an abort signal, renders Markdown, and closes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("# v3.19.0") });
    globalThis.fetch = fetchMock;
    const onClose = vi.fn();
    render(h(ChangelogModal, { isOpen: true, onClose }));
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(GITHUB_CONFIG.changelogUrl, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(document.body.textContent).toContain("v3.19.0");
    document.querySelector("button[aria-label='Close']").click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("moves a rejected auto update to the manual-install surface with the response message", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 409, json: () => Promise.resolve({ message: "Disabled" }) });
    const { container } = render(h(UpdatePanel, { currentVersion: "1.0.0", latestVersion: "1.1.0", installCmd: "npm i -g durindoor@latest", onClose: () => {} }));
    [...container.querySelectorAll("button")].find((button) => button.textContent.includes("Update & Restart")).click();
    await flush();
    expect(container.textContent).toContain("Disabled");
    expect(container.textContent).toContain("npm i -g durindoor@latest");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent.includes("Copy & Shutdown"))).toBe(true);
  });

  it("reloads through the caller only after update completion and dashboard readiness", async () => {
    const onReload = vi.fn();
    globalThis.fetch = vi.fn(async (url) => ({
      ok: true,
      json: async () => String(url).includes("/update/status")
        ? { done: true, success: true, phase: "done" }
        : { ok: true },
    }));
    const { container } = render(h(UpdatePanel, { latestVersion: "3.20.0", installCmd: "npm i -g durindoor@latest", onClose: () => {}, onReload }));
    expect(onReload).not.toHaveBeenCalled();
    await act(async () => {
      [...container.querySelectorAll("button")].find((button) => button.textContent.includes("Update & Restart")).click();
    });
    await flush();
    expect(onReload).toHaveBeenCalledOnce();
  });
});
