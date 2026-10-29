"use client";

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { createHomeTranslator, HOME_LOCALE_OPTIONS, homeLocaleCookie } from "./home.js";

import Icon from "../components/home/ui/Icon.jsx";

const HomeLocaleContext = createContext(null);

const LOCALE_CODES = Object.freeze({
  en: "EN",
  "pt-BR": "PT",
  es: "ES",
  de: "DE",
  ja: "JA",
  "zh-CN": "ZH",
});

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

/** Compact globe + ISO code. Full names live in the listbox only. */
export function HomeLocaleSelect() {
  const { locale, t } = useHomeLocale();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const optionRefs = useRef([]);
  const listId = useId();
  const selectedIndex = HOME_LOCALE_OPTIONS.findIndex((option) => option.value === locale);

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  };

  const selectLocale = (next) => {
    if (next === locale) {
      close(true);
      return;
    }
    document.cookie = homeLocaleCookie(next);
    window.location.reload();
  };

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (!rootRef.current?.contains(event.target)) close();
    };
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const target = optionRefs.current[selectedIndex] ?? optionRefs.current[0];
    target?.focus();
  }, [open, selectedIndex]);

  const move = (index) => {
    const next = (index + HOME_LOCALE_OPTIONS.length) % HOME_LOCALE_OPTIONS.length;
    optionRefs.current[next]?.focus();
  };

  const onListKeyDown = (event) => {
    const current = optionRefs.current.findIndex((node) => node === document.activeElement);
    const from = current < 0 ? selectedIndex : current;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(from + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(from - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      move(0);
    } else if (event.key === "End") {
      event.preventDefault();
      move(HOME_LOCALE_OPTIONS.length - 1);
    }
  };

  return (
    <div className="home-locale" ref={rootRef} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) close();
    }}>
      <button
        ref={buttonRef}
        type="button"
        className="home-locale-btn"
        aria-label={t("Language")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="globe" size={16} />
        <span className="home-locale-code">{LOCALE_CODES[locale]}</span>
      </button>
      {open ? (
        <ul
          id={listId}
          className="home-locale-menu"
          role="listbox"
          aria-label={t("Language")}
          onKeyDown={onListKeyDown}
        >
          {HOME_LOCALE_OPTIONS.map((option, index) => (
            <li key={option.value} role="presentation">
              <button
                type="button"
                role="option"
                className="home-locale-option"
                aria-selected={option.value === locale}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                onClick={() => selectLocale(option.value)}
              >
                <span className="home-locale-code">{LOCALE_CODES[option.value]}</span>
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
