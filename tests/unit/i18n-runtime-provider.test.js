// @vitest-environment happy-dom
import React, { StrictMode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeI18nProvider } from "../../src/i18n/RuntimeI18nProvider.js";
import { teardownRuntimeI18n } from "../../src/i18n/runtime.js";

const navigation = vi.hoisted(() => ({ pathname: "/one" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

describe("RuntimeI18nProvider lifecycle", () => {
  let container;
  let root;
  let callbacks;
  let cancelled;
  let disconnect;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    document.cookie = "locale=vi; path=/";
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    callbacks = new Map();
    cancelled = vi.fn((id) => callbacks.delete(id));
    let nextId = 1;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    }));
    vi.stubGlobal("cancelAnimationFrame", cancelled);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ Hello: "Xin chào" }) })));
    disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    teardownRuntimeI18n();
    container.remove();
    document.cookie = "locale=; max-age=0; path=/";
    vi.unstubAllGlobals();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    vi.restoreAllMocks();
  });

  const render = async (node) => act(async () => root.render(node));

  it("disconnects the document observer when the initialized provider unmounts", async () => {
    await render(React.createElement(RuntimeI18nProvider, null, "ready"));
    await act(async () => {});
    expect(disconnect).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("supports StrictMode's cleanup and remount cycle", async () => {
    await render(React.createElement(StrictMode, null, React.createElement(RuntimeI18nProvider, null, "ready")));
    await act(async () => {});
    expect(document.body.textContent).toContain("ready");
    expect(fetch).toHaveBeenCalled();
    await act(async () => root.unmount());
    expect(disconnect).toHaveBeenCalled();
  });

  it("cancels either outstanding route frame when the route changes or provider unmounts", async () => {
    const reloadSpy = vi.spyOn(await import("../../src/i18n/runtime.js"), "reloadTranslations");
    await render(React.createElement(RuntimeI18nProvider));
    expect(callbacks.size).toBe(1);
    navigation.pathname = "/two";
    await render(React.createElement(RuntimeI18nProvider));
    expect(cancelled).toHaveBeenCalledWith(1);
    const first = callbacks.entries().next().value;
    callbacks.delete(first[0]);
    first[1]();
    expect(callbacks.size).toBe(1);
    const secondId = [...callbacks.keys()][0];
    await act(async () => root.unmount());
    expect(cancelled).toHaveBeenCalledWith(secondId);
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});
