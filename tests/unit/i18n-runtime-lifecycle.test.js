// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMissingTranslationKeys,
  initRuntimeI18n,
  onLocaleChange,
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

  it("records each missing non-English key once and clears callbacks on teardown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));
    const callback = vi.fn();
    onLocaleChange(callback);

    await initRuntimeI18n();
    translate("Untranslated source");
    translate("Untranslated source");
    expect(getMissingTranslationKeys()).toContain("Untranslated source");
    expect(getMissingTranslationKeys().filter((key) => key === "Untranslated source")).toHaveLength(1);

    teardownRuntimeI18n();
    document.cookie = "locale=en; path=/";
    vi.stubGlobal("fetch", vi.fn());
    const { reloadTranslations } = await import("../../src/i18n/runtime.js");
    await reloadTranslations();
    expect(callback).not.toHaveBeenCalled();
  });
});
