import { describe, expect, it } from "vitest";
import {
  createHomeTranslator,
  HOME_LOCALES,
  HOME_MESSAGES,
  homeLocaleCookie,
  homeMetadata,
  LOCALE_COOKIE,
  resolveHomeLocale,
} from "../../website/src/i18n/home.js";
import { FEATURES, RESOLUTIONS } from "../../website/src/components/home/data.js";

const placeholders = (message) => [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

// Pure data imports deliberately exclude the website's React, motion and ThreeUI graph.
describe("homepage locale contract", () => {
  it("keeps the dashboard cookie while restricting the website to its six complete locales", () => {
    expect(HOME_LOCALES).toEqual(["en", "pt-BR", "es", "de", "ja", "zh-CN"]);
    expect(LOCALE_COOKIE).toBe("locale");
    expect(resolveHomeLocale("zh")).toBe("zh-CN");
    expect(resolveHomeLocale("pt-BR")).toBe("pt-BR");
    for (const unsupported of [undefined, null, "fr", "ar", "constructor", "unknown"]) {
      expect(resolveHomeLocale(unsupported)).toBe("en");
    }
  });

  it("persists each selection as a year-long site-wide cookie that SSR can read back", () => {
    for (const locale of HOME_LOCALES) {
      const [pair, ...attributes] = homeLocaleCookie(locale).split("; ");
      const [name, value] = pair.split("=");
      expect(name).toBe(LOCALE_COOKIE);
      expect(resolveHomeLocale(decodeURIComponent(value))).toBe(locale);
      expect(attributes).toEqual(["Path=/", "Max-Age=31536000", "SameSite=Lax"]);
    }
    expect(() => homeLocaleCookie("en; Path=/other")).toThrow(RangeError);
    expect(() => homeLocaleCookie("fr")).toThrow(RangeError);
  });

  it("requires complete translations and preserves interpolation parameters in every language", () => {
    const sourceKeys = Object.keys(HOME_MESSAGES.en).sort();
    for (const locale of HOME_LOCALES) {
      const catalog = HOME_MESSAGES[locale];
      expect(Object.keys(catalog).sort(), locale).toEqual(sourceKeys);
      for (const key of sourceKeys) {
        expect(catalog[key], `${locale}: ${key}`).toEqual(expect.any(String));
        expect(catalog[key].trim(), `${locale}: ${key}`).not.toBe("");
        expect(placeholders(catalog[key]), `${locale}: ${key}`).toEqual(placeholders(key));
      }
    }
  });

  it("covers dynamic feature cards and resolver output without changing model identifiers", () => {
    for (const locale of HOME_LOCALES) {
      const t = createHomeTranslator(locale);
      for (const feature of FEATURES) {
        if (locale !== "en") expect(t(feature.body)).not.toBe(feature.body);
      }
      for (const resolution of RESOLUTIONS) {
        for (const line of resolution.lines) {
          // Translating terminal commentary must not rewrite provider/model IDs.
          const identifiers = line.text.match(/[a-z][a-z0-9-]*\/[a-z][a-z0-9.-]*/g) || [];
          const translated = t(line.text);
          for (const id of identifiers) expect(translated).toContain(id);
        }
      }
    }
  });

  it("fails explicitly for missing messages and interpolation rather than rendering English", () => {
    for (const locale of HOME_LOCALES) {
      const t = createHomeTranslator(locale);
      expect(() => t("A message absent from all catalogs")).toThrow("Missing homepage translation");
      expect(() => t("constructor")).toThrow("Missing homepage translation");
      expect(() => t("{count} bytes")).toThrow("Missing homepage interpolation");
      expect(t("{count} bytes", { count: 0 })).toContain("0");
      // Replacement values are data, never parsed again as template syntax.
      expect(t("{label} output", { label: "model/{name}" })).toContain("model/{name}");
    }
  });

  it("uses the selected language consistently in document and social metadata", () => {
    const socialLocales = ["en_US", "pt_BR", "es_ES", "de_DE", "ja_JP", "zh_CN"];
    HOME_LOCALES.forEach((locale, index) => {
      const metadata = homeMetadata(locale);
      expect(metadata.openGraph.locale).toBe(socialLocales[index]);
      expect(metadata.openGraph.title).toBe(metadata.title);
      expect(metadata.twitter.title).toBe(metadata.title);
      expect(metadata.openGraph.description).toBe(metadata.description);
      expect(metadata.twitter.description).toBe(metadata.description);
      expect(metadata.title).toContain("DurinDoor");
      if (locale !== "en") {
        expect(metadata.title).not.toBe(homeMetadata("en").title);
        expect(metadata.description).not.toBe(homeMetadata("en").description);
        expect(metadata.openGraph.images[0].alt).not.toBe(homeMetadata("en").openGraph.images[0].alt);
      }
    });
    expect(homeMetadata("zh")).toEqual(homeMetadata("zh-CN"));
    expect(homeMetadata("unsupported")).toEqual(homeMetadata("en"));
  });
});
