"use client";

import { DEFAULT_LOCALE, LOCALE_COOKIE, getLocaleDirection, normalizeLocale } from "./config";
import { isBrowser, isRecord, isString, isUndefined } from "../shared/utils/typeChecks.js";

let translationMap = {};
let currentLocale = DEFAULT_LOCALE;
let reloadCallbacks = [];
let observerHandle = null;
let initPromise = null;
let lifecycleVersion = 0;
const missingKeys = new Set();
const textState = new WeakMap();

// Read locale from cookie
function getLocaleFromCookie() {
  if (isUndefined(globalThis.document)) return DEFAULT_LOCALE;
  const cookie = document.cookie.
  split(";").
  find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : DEFAULT_LOCALE;
  return normalizeLocale(value);
}

/**
 * Keep root document language metadata aligned with runtime translations.
 * Browser-only callers may pass aliases; normalization keeps DOM attributes valid.
 */
export function syncDocumentLocale(locale) {
  if (isUndefined(globalThis.document)) return;

  const normalized = normalizeLocale(locale);
  document.documentElement.lang = normalized;
  document.documentElement.dir = getLocaleDirection(normalized);
}

function syncLocaleFromCookie() {
  const locale = getLocaleFromCookie();
  if (locale !== currentLocale) missingKeys.clear();
  currentLocale = locale;
  syncDocumentLocale(locale);
}

// Load translation map
async function loadTranslations(locale) {
  if (locale === "en") {
    translationMap = {};
    return;
  }

  try {
    const response = await fetch(`/i18n/literals/${locale}.json`);
    if (response.ok === false) {
      translationMap = {};
      console.warn(`Failed to load translations for locale ${locale} (status ${response.status})`);
      return;
    }
    try {
      const translations = await response.json();
      translationMap = isRecord(translations) ? translations : {};
      if (translationMap !== translations) {
        console.warn(`Failed to load translations for locale ${locale} (status ${response.status})`);
      }
    } catch {
      translationMap = {};
      console.warn(`Failed to load translations for locale ${locale} (status ${response.status})`);
    }
  } catch {
    translationMap = {};
    console.warn(`Failed to load translations for locale ${locale} (status unavailable)`);
  }
}

// Translate text - exported for use in components
export function translate(text) {
  if (!text || !isString(text)) return text;
  const trimmed = text.trim();
  if (!trimmed) return text;
  if (currentLocale === "en") return text;
  const translated = translationMap[trimmed];
  if (!translated && import.meta.env?.DEV) missingKeys.add(trimmed);
  return translated || text;
}

/** Return the unique missing source strings encountered for the current development locale. */
export function getMissingTranslationKeys() {
  return [...missingKeys];
}

// Get current locale - exported for use in components
export function getCurrentLocale() {
  return currentLocale;
}

// Register callback for locale changes
export function onLocaleChange(callback) {
  reloadCallbacks.push(callback);
  return () => {
    reloadCallbacks = reloadCallbacks.filter((cb) => cb !== callback);
  };
}

// Process text node
function processTextNode(node) {
  if (!node.nodeValue || !node.nodeValue.trim()) return;

  // Skip if parent is script, style, code, or structural elements
  const parent = node.parentElement;
  if (!parent) return;

  // Skip if parent or any ancestor has data-i18n-skip attribute
  let element = parent;
  while (element) {
    if (element.hasAttribute && element.hasAttribute('data-i18n-skip')) {
      return;
    }
    element = element.parentElement;
  }

  const tagName = parent.tagName?.toLowerCase();

  // Skip elements that don't allow text nodes
  const skipTags = [
  "script", "style", "code", "pre",
  "colgroup", "table", "thead", "tbody", "tfoot", "tr",
  "select", "datalist", "optgroup"];


  if (skipTags.includes(tagName)) return;

  // React may reuse a Text node for a new label. Only our last translated
  // value belongs to the old source; an external edit establishes new source.
  const previous = textState.get(node);
  const original = previous && node.nodeValue === previous.rendered ? previous.source : node.nodeValue;
  const translated = translate(original);
  textState.set(node, { source: original, rendered: translated });

  // Only update if different to avoid unnecessary DOM mutations
  if (translated !== node.nodeValue) {
    node.nodeValue = translated;
  }
}

// Process all text nodes in element
function processElement(element) {
  if (!element) return;

  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  let node;
  const nodesToProcess = [];

  // Collect all nodes first to avoid live collection issues
  while (node = walker.nextNode()) {
    nodesToProcess.push(node);
  }

  // Process collected nodes
  nodesToProcess.forEach(processTextNode);
}

// Initialize runtime i18n
export async function initRuntimeI18n() {
  if (!isBrowser()) return;
  if (observerHandle) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const version = lifecycleVersion;
    syncLocaleFromCookie();
    await loadTranslations(currentLocale);
    if (version !== lifecycleVersion) return;

    // Process existing DOM
    processElement(document.body);

    // Watch for new nodes
    observerHandle = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "characterData") processTextNode(mutation.target);
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            processElement(node);
          } else if (node.nodeType === Node.TEXT_NODE) {
            processTextNode(node);
          }
        });
      });
    });

    observerHandle.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true
    });
  })();
  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

/** Disconnect runtime observation. Subscribers retain their callbacks until they unsubscribe. */
export function teardownRuntimeI18n() {
  lifecycleVersion += 1;
  observerHandle?.disconnect();
  observerHandle = null;
  initPromise = null;
  missingKeys.clear();
}

// Reload translations when locale changes
export async function reloadTranslations() {
  syncLocaleFromCookie();
  await loadTranslations(currentLocale);

  // Notify all registered callbacks
  reloadCallbacks.forEach((callback) => callback());

  // Re-process the current source labels, retaining translations only we wrote.
  processElement(document.body);
}
