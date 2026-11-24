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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.cookie = "locale=; max-age=0; path=/";
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
