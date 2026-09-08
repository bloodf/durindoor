"use client";

import { useState, useEffect } from "react";
import { LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { LOCALE_FLAGS } from "@/shared/constants/locales";
import LanguageSwitcher from "./LanguageSwitcher";
import { isUndefined } from "../utils/typeChecks.js";

function getLocaleFromCookie() {
  if (isUndefined(globalThis.document)) return "en";
  const cookie = document.cookie.
  split(";").
  find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
  return normalizeLocale(value);
}

export default function HeaderLanguage() {
  const [open, setOpen] = useState(false);
  const [locale, setLocale] = useState("en");

  useEffect(() => {
    setLocale(getLocaleFromCookie());
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 min-w-11 items-center justify-center p-2 rounded-dd text-dd-muted outline-none focus-visible:shadow-dd-focus hover:text-dd-text hover:bg-dd-surface-2 transition-all"
        aria-label="Change language"
        aria-expanded={open}
        title="Language"
        data-i18n-skip="true"
      >
        <span aria-hidden="true" className="text-lg leading-none">{LOCALE_FLAGS[locale] || "🌐"}</span>
      </button>

      <LanguageSwitcher
        hideTrigger
        isOpen={open}
        onClose={(next) => {
          setOpen(false);
          setLocale(next);
        }} />
      
    </>);

}