// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMissingTranslationKeys,
  initRuntimeI18n,
  onLocaleChange,
  reloadTranslations,
  teardownRuntimeI18n,
  translate,
} from "../../src/i18n/runtime.js";

describe("i18n runtime lifecycle", () => {
  let observe;
  let disconnect;

  beforeEach(() => {
    document.cookie = "locale=vi; path=/";
    observe = vi.spyOn(MutationObserver.prototype, "observe");
    disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
  });

  afterEach(() => {
    teardownRuntimeI18n();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.cookie = "locale=; max-age=0; path=/";
  });

  function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
  }

  it("does not let an older locale response overwrite the newer reload", async () => {
    const viResponse = deferred();
    const frResponse = deferred();
    vi.stubGlobal("fetch", vi.fn((url) => url.includes("/vi.") ? viResponse.promise : frResponse.promise));
    const callback = vi.fn();
    const unsubscribe = onLocaleChange(callback);

    try {
      const older = reloadTranslations();
      document.cookie = "locale=fr; path=/";
      const newer = reloadTranslations();
      frResponse.resolve({ ok: true, status: 200, json: async () => ({ Label: "Français" }) });
      await newer;
      expect(translate("Label")).toBe("Français");
      viResponse.resolve({ ok: true, status: 200, json: async () => ({ Label: "Tiếng Việt" }) });
      await older;

      expect(translate("Label")).toBe("Français");
      expect(callback).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it("translates visible text while a same-locale route reload is pending", async () => {
    const initialResponse = deferred();
    const routeResponse = deferred();
    const fetch = vi.fn().mockReturnValueOnce(initialResponse.promise).mockReturnValueOnce(routeResponse.promise);
    vi.stubGlobal("fetch", fetch);
    document.body.innerHTML = "<span>Label</span>";
    const label = document.querySelector("span");

    const init = initRuntimeI18n();
    const reload = reloadTranslations();
    expect(fetch.mock.calls).toEqual([
      ["/i18n/literals/vi.json"],
      ["/i18n/literals/vi.json"],
    ]);

    initialResponse.resolve({ ok: true, status: 200, json: async () => ({ Label: "Tiếng Việt" }) });
    await init;
    try {
      expect(label.textContent).toBe("Tiếng Việt");
    } finally {
      routeResponse.resolve({ ok: true, status: 200, json: async () => ({ Label: "Nhãn" }) });
      await reload;
    }
    expect(label.textContent).toBe("Nhãn");
  });

  it("rejects a response from before switching away and back while the new request is pending", async () => {
    const oldResponse = deferred();
    const awayResponse = deferred();
    const newResponse = deferred();
    vi.stubGlobal("fetch", vi.fn()
      .mockReturnValueOnce(oldResponse.promise)
      .mockReturnValueOnce(awayResponse.promise)
      .mockReturnValueOnce(newResponse.promise));
    document.body.innerHTML = "<span>Label</span>";
    const label = document.querySelector("span");

    const older = reloadTranslations();
    document.cookie = "locale=fr; path=/";
    const away = reloadTranslations();
    document.cookie = "locale=vi; path=/";
    const newer = reloadTranslations();

    oldResponse.resolve({ ok: true, status: 200, json: async () => ({ Label: "Stale" }) });
    await older;
    try {
      expect(label.textContent).toBe("Label");
    } finally {
      awayResponse.resolve({ ok: true, status: 200, json: async () => ({ Label: "Français" }) });
      newResponse.resolve({ ok: true, status: 200, json: async () => ({ Label: "Nhãn" }) });
      await Promise.all([away, newer]);
    }
    expect(label.textContent).toBe("Nhãn");
  });

  it("observes late text when a route reload supersedes initialization", async () => {
    const initialResponse = deferred();
    const routeResponse = deferred();
    const fetch = vi.fn().mockReturnValueOnce(initialResponse.promise).mockReturnValueOnce(routeResponse.promise);
    vi.stubGlobal("fetch", fetch);

    const init = initRuntimeI18n();
    const reload = reloadTranslations();
    routeResponse.resolve({ ok: true, status: 200, json: async () => ({ Label: "Tiếng Việt" }) });
    await reload;
    expect(translate("Label")).toBe("Tiếng Việt");

    initialResponse.resolve({ ok: true, status: 200, json: async () => ({ Label: "Stale" }) });
    await init;
    expect(translate("Label")).toBe("Tiếng Việt");
    expect(observe).toHaveBeenCalledTimes(1);

    const label = document.createElement("span");
    label.textContent = "Label";
    document.body.append(label);
    await vi.waitFor(() => expect(label.textContent).toBe("Tiếng Việt"));
  });

  it("reprocesses the current page when a same-locale route reload completes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ Label: "Tiếng Việt" }),
    }));
    document.body.innerHTML = "<span>Label</span>";

    await reloadTranslations();

    expect(document.querySelector("span").textContent).toBe("Tiếng Việt");
  });

  it("does not let initialization invalidated by teardown publish or clear a later handle", async () => {
    const first = deferred();
    const second = deferred();
    const fetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", fetch);
    document.body.innerHTML = "<span>Label</span>";

    const staleInit = initRuntimeI18n();
    teardownRuntimeI18n();
    const activeInit = initRuntimeI18n();
    first.resolve({ ok: true, status: 200, json: async () => ({ Label: "Old" }) });
    await staleInit;
    expect(observe).not.toHaveBeenCalled();
    const joinedActiveInit = initRuntimeI18n();
    expect(fetch).toHaveBeenCalledTimes(2);
    second.resolve({ ok: true, status: 200, json: async () => ({ Label: "New" }) });
    await Promise.all([activeInit, joinedActiveInit]);
    expect(translate("Label")).toBe("New");
    expect(observe).toHaveBeenCalledTimes(1);
  });

  it("keeps English on a 404 and warns once with the locale and status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await initRuntimeI18n();

    expect(translate("Source label" )).toBe("Source label");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("vi");
    expect(warn.mock.calls[0][0]).toContain("404");
  });

  it("keeps English on invalid JSON and warns once", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError("invalid JSON")),
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await initRuntimeI18n();

    expect(translate("Source label")).toBe("Source label");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("vi");
    expect(warn.mock.calls[0][0]).toContain("200");
  });

  it("uses one observer for repeated initialization and disconnects it on teardown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));

    await Promise.all([initRuntimeI18n(), initRuntimeI18n()]);
    expect(observe).toHaveBeenCalledTimes(1);

    teardownRuntimeI18n();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("keeps active locale subscriptions through teardown and reinitialization", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));
    const callback = vi.fn();
    const unsubscribe = onLocaleChange(callback);

    try {
      await initRuntimeI18n();
      teardownRuntimeI18n();
      await initRuntimeI18n();
      document.cookie = "locale=en; path=/";
      await reloadTranslations();
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();
      document.cookie = "locale=vi; path=/";
      await reloadTranslations();
      expect(callback).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it("records each missing key once for the current locale and clears it on teardown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));

    await initRuntimeI18n();
    translate("Untranslated source");
    translate("Untranslated source");
    expect(getMissingTranslationKeys().filter((key) => key === "Untranslated source")).toHaveLength(1);

    document.cookie = "locale=fr; path=/";
    await reloadTranslations();
    expect(getMissingTranslationKeys()).not.toContain("Untranslated source");

    translate("French diagnostic");
    expect(getMissingTranslationKeys()).toContain("French diagnostic");
    teardownRuntimeI18n();
    expect(getMissingTranslationKeys()).toEqual([]);
  });
});
