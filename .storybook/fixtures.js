import { installStoryNetwork, STORY_FIXTURE_SCENARIOS } from "./network.js";
import { installStoryNavigation } from "./next-navigation.js";
import { LOCALE_COOKIE, getLocaleDirection, normalizeLocale } from "../src/i18n/config.js";

function cookieValue(name) {
  const entry = globalThis.document?.cookie.split(";").find((part) => part.trim().startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.trim().slice(name.length + 1)) : null;
}

function setCookie(name, value) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; SameSite=Lax`;
}

function clearCookie(name) {
  document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
}

async function restoreAll(restores) {
  const errors = [];
  for (const restore of restores.reverse()) {
    try { await restore(); } catch (error) { errors.push(error); }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, "setupStoryFixture cleanup failed");
}

/**
 * Install deterministic dependencies for one actual production story. Scenario
 * names are intentionally finite: add concrete API routes to network.js before
 * adding a story that needs them. Returned cleanup restores only mutations this
 * fixture made, so Storybook's own state remains untouched.
 */
export async function setupStoryFixture({
  scenario = "default",
  locale = "en",
  pathname = "/",
  params = {},
  selectedLayoutSegments = [],
  routes = null,
  externalFixtures = null,
} = {}) {
  if (!STORY_FIXTURE_SCENARIOS.includes(scenario)) {
    throw new Error(`Unknown Storybook fixture scenario: ${scenario}`);
  }
  const normalizedLocale = normalizeLocale(locale);
  const restores = [];

  try {
    const url = new URL(pathname, "http://storybook.local");
    restores.push(installStoryNetwork({ scenario, routes, externalFixtures }));
    restores.push(installStoryNavigation({ pathname: url.pathname, query: url.search, params, selectedLayoutSegments }));

    const html = globalThis.document?.documentElement;
    if (html) {
      const previousLang = html.lang;
      const hadDir = html.hasAttribute("dir");
      const previousDir = html.getAttribute("dir");
      restores.push(() => {
        html.lang = previousLang;
        if (hadDir) html.setAttribute("dir", previousDir);
        else html.removeAttribute("dir");
      });
      html.lang = normalizedLocale;
      html.setAttribute("dir", getLocaleDirection(normalizedLocale));
    }
    if (globalThis.document) {
      const previousLocale = cookieValue(LOCALE_COOKIE);
      const restoreLocale = previousLocale === null
        ? () => clearCookie(LOCALE_COOKIE)
        : () => setCookie(LOCALE_COOKIE, previousLocale);
      setCookie(LOCALE_COOKIE, normalizedLocale);
      restores.push(restoreLocale);
    }
  } catch (error) {
    try { await restoreAll(restores); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "setupStoryFixture failed and rollback failed"); }
    throw error;
  }

  let cleaned = false;
  return {
    appliedLocale: normalizedLocale,
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      await restoreAll(restores);
    },
  };
}

export { STORY_FIXTURE_SCENARIOS };
