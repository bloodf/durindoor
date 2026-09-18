import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_NAMES, normalizeLocale } from "../../../src/i18n/config.js";
import en from "./locales/en.js";
import ptBR from "./locales/pt-BR.js";
import es from "./locales/es.js";
import de from "./locales/de.js";
import ja from "./locales/ja.js";
import zhCN from "./locales/zh-CN.js";

export { LOCALE_COOKIE };
export const HOME_LOCALES = Object.freeze(["en", "pt-BR", "es", "de", "ja", "zh-CN"]);
export const HOME_MESSAGES = Object.freeze({ en, "pt-BR": ptBR, es, de, ja, "zh-CN": zhCN });
export const HOME_LOCALE_OPTIONS = Object.freeze(HOME_LOCALES.map((value) => Object.freeze({ value, label: LOCALE_NAMES[value] })));

/** The website supports a subset of dashboard locales, using the same cookie. */
export function resolveHomeLocale(value) {
  const locale = normalizeLocale(value);
  return HOME_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
}

/** Source messages are keys, not fallbacks. A missing key is a programming error. */
export function createHomeTranslator(locale) {
  const selected = resolveHomeLocale(locale);
  const messages = HOME_MESSAGES[selected];
  return (key, values = {}) => {
    if (!Object.hasOwn(messages, key)) throw new Error(`Missing homepage translation: ${selected}: ${key}`);
    return messages[key].replace(/\{(\w+)\}/g, (_, name) => {
      if (!Object.hasOwn(values, name)) throw new Error(`Missing homepage interpolation: ${name}`);
      return String(values[name]);
    });
  };
}

/** Persist before navigation so the next server render owns text, metadata and lang. */
export function homeLocaleCookie(locale) {
  if (!HOME_LOCALES.includes(locale)) throw new RangeError("Unsupported homepage locale");
  return `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

/** Framework-independent metadata, shared by the document and homepage layouts. */
export function homeMetadata(locale) {
  const selected = resolveHomeLocale(locale);
  const t = createHomeTranslator(selected);
  const title = t("DurinDoor. Speak, friend, and enter");
  const description = t("Add credentials once. Point every OpenAI-compatible tool at http://localhost:20128/v1.");
  const openGraphLocale = { en: "en_US", "pt-BR": "pt_BR", es: "es_ES", de: "de_DE", ja: "ja_JP", "zh-CN": "zh_CN" }[selected];
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      locale: openGraphLocale,
      type: "website",
      images: [{ url: "/home/door-poster.webp", width: 1600, height: 679, alt: t("Ancient stone door glowing emerald in dark ruins") }],
    },
    twitter: { card: "summary_large_image", title, description },
  };
}
