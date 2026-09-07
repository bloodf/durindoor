// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLocaleDirection, normalizeLocale } from "@/i18n/config.js";
import { reloadTranslations, syncDocumentLocale } from "@/i18n/runtime.js";

afterEach(() => {
  document.cookie = "locale=; path=/; max-age=0";
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
  vi.unstubAllGlobals();
});

it("keeps current rendered text across translation reloads and locale changes", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url) => ({ json: async () => String(url).includes("/fr.json") ? { "Processing…": "Traitement…", "Authorization successful!": "Autorisation réussie !" } : {} })));
  const heading = document.createElement("h1");
  const text = document.createTextNode("Processing…");
  heading.appendChild(text);
  document.body.appendChild(heading);
  try {
    document.cookie = "locale=fr; path=/";
    await reloadTranslations();
    expect(heading.textContent).toBe("Traitement…");
    text.nodeValue = "Authorization successful!";
    await reloadTranslations();
    expect(heading.textContent).toBe("Autorisation réussie !");
    document.cookie = "locale=en; path=/";
    await reloadTranslations();
    expect(heading.textContent).toBe("Authorization successful!");
  } finally { heading.remove(); }
});

describe("Durin DS locale direction", () => {
  it.each([
    ["zh", "zh-CN"],
    ["zh-CN", "zh-CN"],
    ["unknown", "en"],
  ])("normalizes %s to %s", (locale, expected) => {
    expect(normalizeLocale(locale)).toBe(expected);
  });

  it.each(["ar", "he", "fa", "ur"])("marks %s right-to-left", (locale) => {
    expect(getLocaleDirection(locale)).toBe("rtl");
  });

  it("returns to left-to-right and falls back for invalid locales", () => {
    syncDocumentLocale("ar");
    syncDocumentLocale("en");
    expect(document.documentElement).toMatchObject({ lang: "en", dir: "ltr" });

    syncDocumentLocale("unsupported");
    expect(document.documentElement).toMatchObject({ lang: "en", dir: "ltr" });
  });

  it("syncs root attributes when configured locale reloads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({}) }));

    document.cookie = "locale=ar; path=/";
    await reloadTranslations();
    expect(document.documentElement).toMatchObject({ lang: "ar", dir: "rtl" });

    document.cookie = "locale=en; path=/";
    await reloadTranslations();
    expect(document.documentElement).toMatchObject({ lang: "en", dir: "ltr" });

    document.cookie = "locale=unsupported; path=/";
    await reloadTranslations();
    expect(document.documentElement).toMatchObject({ lang: "en", dir: "ltr" });
  });
});
