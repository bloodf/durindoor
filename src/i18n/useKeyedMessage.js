"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_LOCALE } from "./config";
import { getPublishedKeyedLocale, subscribeToKeyedLocale } from "./runtime";
import { getKeyedMessage } from "./keyedMessages";

const getServerLocale = () => DEFAULT_LOCALE;

/** Render English consistently through SSR/hydration, then follow published locales. */
export function useKeyedMessage(key) {
  const locale = useSyncExternalStore(subscribeToKeyedLocale, getPublishedKeyedLocale, getServerLocale);
  return getKeyedMessage(key, locale);
}
