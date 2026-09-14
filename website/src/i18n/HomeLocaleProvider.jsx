"use client";

import { createContext, useContext, useMemo } from "react";
import Select from "@/shared/ui/components/Select.jsx";
import { createHomeTranslator, HOME_LOCALE_OPTIONS, homeLocaleCookie } from "./home.js";

const HomeLocaleContext = createContext(null);

/** The cookie-derived server locale also seeds hydration; no browser-only fallback. */
export function HomeLocaleProvider({ locale, children }) {
  const value = useMemo(() => ({ locale, t: createHomeTranslator(locale) }), [locale]);
  return <HomeLocaleContext.Provider value={value}>{children}</HomeLocaleContext.Provider>;
}

export function useHomeLocale() {
  const context = useContext(HomeLocaleContext);
  if (!context) throw new Error("Homepage requires HomeLocaleProvider");
  return context;
}

/** Full navigation makes translated SSR, social metadata and document language atomic. */
export function HomeLocaleSelect() {
  const { locale, t } = useHomeLocale();
  const selectLocale = (next) => {
    if (next === locale) return;
    document.cookie = homeLocaleCookie(next);
    window.location.reload();
  };
  return (
    <div className="home-locale">
      <Select
        aria-label={t("Language")}
        value={locale}
        options={HOME_LOCALE_OPTIONS}
        onChange={selectLocale}
        size="sm"
      />
    </div>
  );
}
