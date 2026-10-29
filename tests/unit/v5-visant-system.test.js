// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readProviderStream } from "@/app/(dashboard)/dashboard/translator/readProviderStream.js";
import { loadToolConfiguration } from "@/app/(dashboard)/dashboard/cli-tools/toolConfiguration.js";
import Button from "@/shared/components/Button.js";
import { inferredButtonIcon, ReviewNativeLink } from "@/shared/ui/v5/motion/ReviewNativeButton.jsx";
import ReviewGlyph from "@/shared/ui/v5/motion/ReviewGlyph.jsx";
import ReviewIconHelp from "@/shared/ui/v5/motion/ReviewIconHelp.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const cleanups = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); });
function mount(element) {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); act(() => root.render(element));
  cleanups.push(() => { act(() => root.unmount()); host.remove(); });
  return host;
}

describe("Visant shared-system regressions", () => {
  it("preserves authored provider artwork passed through a legacy glyph slot", () => {
    document.documentElement.dataset.v5Review = "true";
    try {
      const artwork = React.createElement("svg", { "aria-label": "OpenAI provider" });
      const host = mount(React.createElement(ReviewGlyph, { className: "material-symbols-outlined text-sm" }, artwork));
      expect(host.querySelector('svg[aria-label="OpenAI provider"]')).not.toBeNull();
      expect(host.querySelector('[data-icon-name="[object Object]"]')).toBeNull();
      expect(host.querySelector(".material-symbols-outlined")).toBeNull();
    } finally { delete document.documentElement.dataset.v5Review; }
  });
  it("virtualizes only internal review links and preserves download, fragment and external anchors", () => {
    document.documentElement.dataset.v5Review = "true";
    try {
      expect(ReviewNativeLink({ href: "/dashboard/headroom", children: "Open" }).type).not.toBe("a");
      for (const props of [{ href: "/dashboard/export", download: "" }, { href: "#details" }, { href: "https://example.test" }]) expect(ReviewNativeLink(props).type).toBe("a");
    } finally { delete document.documentElement.dataset.v5Review; }
    expect(ReviewNativeLink({ href: "/dashboard/headroom" }).type).toBe("a");
  });
  it("rejects absent tool settings and transports instead of treating them as disabled", async () => {
    const payloads = [{ connections: [] }, {}, {}, { keys: [] }];
    let i = 0;
    await expect(loadToolConfiguration(async () => new Response(JSON.stringify(payloads[i++])))).rejects.toThrow("incomplete");
    i = 0; payloads[1] = { cloudEnabled: false }; payloads[2] = { tunnel: null, tailscale: null };
    await expect(loadToolConfiguration(async () => new Response(JSON.stringify(payloads[i++])))).rejects.toThrow("incomplete");
    const valid = [{ connections: [] }, { cloudEnabled: false }, { tunnel: { enabled: false }, tailscale: { settingsEnabled: false } }, { keys: [] }];
    i = 0;
    await expect(loadToolConfiguration(async () => new Response(JSON.stringify(valid[i++])))).resolves.toMatchObject({ settings: { cloudEnabled: false } });
  });
  it("renders provider chunks before completion, including split UTF-8 characters", async () => {
    let stream;
    const response = new Response(new ReadableStream({ start(controller) { stream = controller; } }));
    const updates = [];
    const promise = readProviderStream(response, { signal: new AbortController().signal, onChunk: (value) => updates.push(value) });
    stream.enqueue(new TextEncoder().encode("first"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updates).toEqual(["first"]);
    const bytes = new TextEncoder().encode("✓");
    stream.enqueue(bytes.slice(0, 1)); stream.enqueue(bytes.slice(1)); stream.close();
    expect(await promise).toBe("first✓");
    expect(updates.at(-1)).toBe("first✓");
  });

  it("retains partial output when transport fails", async () => {
    let stream;
    const updates = [];
    const response = new Response(new ReadableStream({ start(controller) { stream = controller; } }));
    const promise = readProviderStream(response, { signal: new AbortController().signal, onChunk: (value) => updates.push(value) });
    stream.enqueue(new TextEncoder().encode("partial"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    stream.error(new Error("Disconnected"));
    await expect(promise).rejects.toThrow("Disconnected");
    expect(updates).toEqual(["partial"]);
  });

  it("stops a pending stream and releases the reader on cancellation", async () => {
    const cancelled = vi.fn();
    const controller = new AbortController();
    const response = new Response(new ReadableStream({ cancel: cancelled }));
    const promise = readProviderStream(response, { signal: controller.signal, onChunk: vi.fn() });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toHaveBeenCalledOnce();
    expect(response.body.locked).toBe(false);
  });

  it("does not infer duplicate icons when the authored ButtonIcon function is minified", () => {
    const button = Button({ children: "Add model", icon: "add" });
    const icon = React.Children.toArray(button.props.children)[0];
    Object.defineProperty(icon.type, "name", { value: "a", configurable: true });
    expect(icon.type.displayName).toBe("ButtonIcon");
    expect(inferredButtonIcon(button.props.children)).toBe(null);
    const host = mount(button);
    expect(host.querySelectorAll(".material-symbols-outlined")).toHaveLength(1);
  });

  it("keeps icon help on the prefix glyph and clicking it focuses the field", async () => {
    document.documentElement.dataset.v5Review = "true";
    cleanups.push(() => delete document.documentElement.dataset.v5Review);
    const host = mount(React.createElement(React.Fragment, null, React.createElement("div", null, React.createElement("span", { className: "pointer-events-none" }, React.createElement("span", { className: "material-symbols-outlined" }, "search")), React.createElement("input", { "aria-label": "Find model" })), React.createElement(ReviewIconHelp)));
    const icon = host.querySelector(".material-symbols-outlined");
    await act(async () => { icon.dispatchEvent(new Event("pointerdown", { bubbles: true })); icon.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(document.activeElement).toBe(host.querySelector("input"));
    await act(async () => host.querySelector("div").dispatchEvent(new Event("pointerover", { bubbles: true })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 140)); });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    await act(async () => icon.dispatchEvent(new Event("pointerover", { bubbles: true })));
    expect(document.querySelector('[role="tooltip"]').textContent).toMatch(/Search/i);
  });
});
