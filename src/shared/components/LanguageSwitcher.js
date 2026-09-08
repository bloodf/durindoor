"use client";

import { useState, useEffect } from "react";
import { LOCALES, LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { reloadTranslations } from "@/i18n/runtime";
import { isBoolean, isUndefined } from "../utils/typeChecks.js";
import Modal from "@/shared/ui/components/Modal.jsx";

function getLocaleFromCookie() {
  if (isUndefined(globalThis.document)) return "en";
  const cookie = document.cookie.
  split(";").
  find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
  return normalizeLocale(value);
}

// Locale display names and flags - will be translated by runtime i18n
const getLocaleInfo = (locale) => {
  const locales = {
    "en": { name: "English", flag: "🇺🇸" },
    "vi": { name: "Tiếng Việt", flag: "🇻🇳" },
    "zh-CN": { name: "简体中文", flag: "🇨🇳" },
    "zh-TW": { name: "繁體中文", flag: "🇹🇼" },
    "ja": { name: "日本語", flag: "🇯🇵" },
    "pt-BR": { name: "Português (Brasil)", flag: "🇧🇷" },
    "pt-PT": { name: "Português (Portugal)", flag: "🇵🇹" },
    "ko": { name: "한국어", flag: "🇰🇷" },
    "es": { name: "Español", flag: "🇪🇸" },
    "de": { name: "Deutsch", flag: "🇩🇪" },
    "fr": { name: "Français", flag: "🇫🇷" },
    "he": { name: "עברית", flag: "🇮🇱" },
    "ar": { name: "العربية", flag: "🇸🇦" },
    "ru": { name: "Русский", flag: "🇷🇺" },
    "pl": { name: "Polski", flag: "🇵🇱" },
    "cs": { name: "Čeština", flag: "🇨🇿" },
    "nl": { name: "Nederlands", flag: "🇳🇱" },
    "tr": { name: "Türkçe", flag: "🇹🇷" },
    "uk": { name: "Українська", flag: "🇺🇦" },
    "tl": { name: "Tagalog", flag: "🇵🇭" },
    "id": { name: "Indonesia", flag: "🇮🇩" },
    "th": { name: "ไทย", flag: "🇹🇭" },
    "hi": { name: "हिन्दी", flag: "🇮🇳" },
    "bn": { name: "বাংলা", flag: "🇧🇩" },
    "ur": { name: "اردو", flag: "🇵🇰" },
    "ro": { name: "Română", flag: "🇷🇴" },
    "sv": { name: "Svenska", flag: "🇸🇪" },
    "it": { name: "Italiano", flag: "🇮🇹" },
    "el": { name: "Ελληνικά", flag: "🇬🇷" },
    "hu": { name: "Magyar", flag: "🇭🇺" },
    "fi": { name: "Suomi", flag: "🇫🇮" },
    "da": { name: "Dansk", flag: "🇩🇰" },
    "no": { name: "Norsk", flag: "🇳🇴" },
    "fa": { name: "فارسی", flag: "🇮🇷" }
  };
  return locales[locale] || { name: locale, flag: "🌐" };
};

export default function LanguageSwitcher({ className = "", isOpen: controlledOpen, onClose, hideTrigger = false }) {
  const [locale, setLocale] = useState("en");
  const [isPending, setIsPending] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const [error, setError] = useState(null);

  const isControlled = isBoolean(controlledOpen);
  const isOpen = isControlled ? controlledOpen : internalOpen;
  const setIsOpen = (value, nextLocale = locale) => {
    if (isControlled) {
      if (!value && onClose) onClose(nextLocale);
    } else {
      setInternalOpen(value);
    }
  };

  useEffect(() => {
    setLocale(getLocaleFromCookie());
  }, []);

  const handleSetLocale = async (nextLocale) => {
    if (nextLocale === locale || isPending) return;

    setIsPending(true);
    setError(null);
    try {
      const response = await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: nextLocale }),
      });
      if (!response.ok) {
        throw new Error(`Locale request failed: ${response.status}`);
      }

      await reloadTranslations();
      setLocale(nextLocale);
      setIsOpen(false, nextLocale);
    } catch (err) {
      console.error("Failed to set locale:", err);
      setError(err?.message || "Could not switch language");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className={className}>
      {!hideTrigger && (
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          disabled={isPending}
          className="flex min-h-11 items-center gap-2 rounded-dd px-3 text-dd-muted outline-none transition-colors hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus disabled:opacity-50"
          title="Language"
          data-i18n-skip="true"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[20px]">language</span>
          <span className="text-sm font-medium">{getLocaleInfo(locale).name}</span>
          <span className="text-lg">{getLocaleInfo(locale).flag}</span>
        </button>
      )}

      <Modal
        open={isOpen}
        onClose={() => setIsOpen(false)}
        title="Select Language"
        size="lg"
        pending={isPending}
      >
        {error ? (
          <div role="alert" className="mb-3 flex min-h-11 items-center gap-2 rounded-dd border border-dd-danger bg-dd-danger/10 px-3 text-[13px] text-dd-danger">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">error</span>
            <span>{error}</span>
          </div>
        ) : null}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2">
          {LOCALES.map((item) => {
            const active = locale === item;
            const info = getLocaleInfo(item);
            return (
              <button
                type="button"
                key={item}
                onClick={() => handleSetLocale(item)}
                disabled={isPending}
                aria-pressed={active}
                className={`flex min-h-11 flex-col items-center justify-center gap-1 rounded-dd px-2 py-3 text-xs font-medium outline-none transition-colors focus-visible:shadow-dd-focus disabled:opacity-60 ${
                  active
                    ? "bg-dd-accent-soft text-dd-accent ring-2 ring-dd-accent"
                    : "text-dd-text hover:bg-dd-surface-2"
                }`}
                title={info.name}
              >
                <span aria-hidden="true" className="text-2xl leading-none">{info.flag}</span>
                <span className="line-clamp-2 flex h-8 items-center text-center leading-tight">{info.name}</span>
                {active && <span aria-hidden="true" className="material-symbols-outlined text-sm">check</span>}
              </button>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}
