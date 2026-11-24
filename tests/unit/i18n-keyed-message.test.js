// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCurrentLocale, initRuntimeI18n, onLocaleChange, reloadTranslations, teardownRuntimeI18n } from "../../src/i18n/runtime.js";
import { getKeyedMessage, REQUEST_DETAILS_TITLE } from "../../src/i18n/keyedMessages.js";
import { useKeyedMessage } from "../../src/i18n/useKeyedMessage.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("keyed Request details title", () => {
  let root;
  let container;

  function createTitleRoot() {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }

  function Title() {
    return React.createElement("h2", { "data-i18n-skip": true }, useKeyedMessage(REQUEST_DETAILS_TITLE));
  }

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    teardownRuntimeI18n();
    vi.unstubAllGlobals();
    document.cookie = "locale=; max-age=0; path=/";
    vi.restoreAllMocks();
  });

  it("retains shipped translations and falls back for other or absent locales", () => {
    expect(getKeyedMessage(REQUEST_DETAILS_TITLE, "vi")).toBe("Chi tiết yêu cầu");
    expect(getKeyedMessage(REQUEST_DETAILS_TITLE, "id")).toBe("Detail Permintaan");
    expect(getKeyedMessage(REQUEST_DETAILS_TITLE, "zh-CN")).toBe("请求详情");
    expect(getKeyedMessage(REQUEST_DETAILS_TITLE, "fr")).toBe("Request details");
    expect(getKeyedMessage("missing.key", "vi")).toBe("missing.key");
    for (const key of ["constructor", "toString", "__proto__"]) {
      expect(getKeyedMessage(key, "vi")).toBe(key);
      expect(getKeyedMessage(key, "fr")).toBe(key);
    }
  });

  it("updates the keyed and literal titles on initial publication without a reload", async () => {
    createTitleRoot();
    document.cookie = "locale=vi; path=/";
    const body = Promise.withResolvers();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: () => body.promise })));
    const legacyCallback = vi.fn();
    const unsubscribe = onLocaleChange(legacyCallback);

    try {
      const init = initRuntimeI18n();
      await act(async () => root.render(React.createElement(React.Fragment, null, React.createElement(Title),
        React.createElement("p", null, "Request details"))));
      expect(container.querySelector("h2").textContent).toBe("Request details");
      expect(container.querySelector("p").textContent).toBe("Request details");

      await act(async () => {
        body.resolve({ "Request details": "Chi tiết yêu cầu" });
        await init;
      });
      expect(container.querySelector("h2").textContent).toBe("Chi tiết yêu cầu");
      expect(container.querySelector("p").textContent).toBe("Chi tiết yêu cầu");
      expect(legacyCallback).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it("mounts in English while a locale body that will fail is pending", async () => {
    createTitleRoot();
    document.cookie = "locale=id; path=/";
    const body = Promise.withResolvers();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: () => body.promise })));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const reload = reloadTranslations();
    await act(async () => root.render(React.createElement(Title)));
    expect(container.textContent).toBe("Request details");

    await act(async () => {
      body.reject(new Error("invalid JSON"));
      await reload;
    });
    expect(container.textContent).toBe("Request details");
  });

  it("keeps the prior locale on rerender and remount while a newer request is blocked", async () => {
    createTitleRoot();
    document.cookie = "locale=vi; path=/";
    const response = Promise.withResolvers();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockReturnValueOnce(response.promise));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await act(async () => reloadTranslations());
    await act(async () => root.render(React.createElement(Title)));
    expect(container.textContent).toBe("Chi tiết yêu cầu");

    document.cookie = "locale=id; path=/";
    const reload = reloadTranslations();
    await act(async () => root.render(React.createElement(Title)));
    expect(container.textContent).toBe("Chi tiết yêu cầu");
    await act(async () => root.render(React.createElement(Title, { key: "reopened" })));
    expect(container.textContent).toBe("Chi tiết yêu cầu");

    await act(async () => {
      response.resolve({ ok: false, status: 503 });
      await reload;
    });
    expect(container.textContent).toBe("Request details");
  });

  it("renders an accessible dialog title and follows real locale publications", async () => {
    createTitleRoot();
    document.cookie = "locale=vi; path=/";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));

    function DrawerTitle() {
      return React.createElement("div", { role: "dialog", "aria-labelledby": "title" },
        React.createElement("h2", { id: "title" }, React.createElement("span", { "data-i18n-skip": "true" }, useKeyedMessage(REQUEST_DETAILS_TITLE))));
    }

    await act(async () => root.render(React.createElement(DrawerTitle)));
    expect(container.querySelector('[role="dialog"]').getAttribute("aria-labelledby")).toBe("title");
    expect(container.querySelector("h2").textContent).toBe("Request details");
    await act(async () => reloadTranslations());
    expect(container.querySelector("h2").textContent).toBe("Chi tiết yêu cầu");

    document.cookie = "locale=fr; path=/";
    await act(async () => reloadTranslations());
    expect(getCurrentLocale()).toBe("fr");
    expect(container.querySelector("h2").textContent).toBe("Request details");

    document.cookie = "locale=en; path=/";
    await act(async () => reloadTranslations());
    expect(container.querySelector("h2").textContent).toBe("Request details");
  });

  it("keeps English when the existing locale request fails", async () => {
    createTitleRoot();
    document.cookie = "locale=id; path=/";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await act(async () => root.render(React.createElement(Title)));
    await act(async () => reloadTranslations());
    expect(container.textContent).toBe("Request details");
  });
});
