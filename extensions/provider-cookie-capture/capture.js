/**
 * Core of the DurinDoor provider cookie capture. Pure ES module: the `chrome`
 * namespace, `fetch` and the clock are injected so every path runs against mocks.
 *
 * Rules this module keeps (see README.md):
 *  - runs only from a popup the user opened, and only after an explicit confirmation
 *    of provider and dashboard destination;
 *  - asks for optional permissions on exactly two origins (provider, paired
 *    dashboard) plus `cookies`, and gives back what it was granted afterwards;
 *  - reads only cookie names that are in both the built-in table and the pairing, each by its exact
 *    name; built-in hashed families use one bounded provider-URL enumeration in the confirmed
 *    tab store, matching names before reading values;
 *  - for a provider whose credential is a localStorage item (TinyCMS, DeepSeek Web), reads only the
 *    built-in item names, once, from the confirmed tab, through `chrome.scripting`, and only
 *    while that tab and its page are still on the provider origin;
 *  - sends one request, to the dashboard URL named by the pairing, and never retries;
 *  - never stores, logs or echoes a cookie value or the pairing secret.
 */

import { PROVIDERS, PAIRING_HEADER, IMPORT_PATH, PAIRING_TOKEN_RE, MAX_COOKIES } from "./providers.js";
import { isString, isNumber, isRecord } from "./types.js";

const MAX_PAIRING_TEXT = 4096;
const MAX_PAIRING_LIFETIME_MS = 10 * 60 * 1000;
const MAX_TARGET_LENGTH = 200;
const REQUEST_TIMEOUT_MS = 15_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Fixed user-facing text. Nothing here is built from cookie values, the secret or server output. */
export const MESSAGES = Object.freeze({
  invalid_pairing: "That is not a DurinDoor pairing. Paste the pairing JSON from the dashboard.",
  unsupported_provider: "This extension does not support that provider.",
  origin_mismatch: "The pairing names a different site than this extension supports for that provider.",
  invalid_destination: "The pairing destination is not an allowed DurinDoor import address. Use HTTPS, or http to localhost.",
  pairing_expired: "The pairing has expired. Create a new pairing in the dashboard. Nothing was read or sent.",
  wrong_tab: "Open the supported provider site in the active tab, then try again.",
  not_confirmed: "Confirm the provider and dashboard destination first. Nothing was read or sent.",
  already_used: "This pairing was already submitted. Create a new pairing in the dashboard.",
  permission_denied: "Permission was not granted, so nothing was read or sent. Click Send to try again, or Cancel.",
  no_cookie_store: "Could not find the browser session for this tab. Nothing was sent.",
  no_cookies: "No approved session cookie was found. Sign in to the provider in this tab, create a new pairing and try again.",
  ambiguous_cookies: "The provider site holds more than one signed-in session cookie, so nothing was sent. Sign out, sign in once more in this tab, create a new pairing and try again.",
  no_local_storage: "The provider page holds no approved session value. Open the provider site in this tab, create a new pairing and try again.",
  tab_navigated: "The tab left the provider site while its session value was being read, so nothing was sent. Return to the provider site in this tab and click Send again.",
  cancelled: "Cancelled. Create a new pairing if you want to try again.",
  network_error: "Could not reach the dashboard. The pairing may be spent; create a new pairing before trying again.",
  pairing_rejected: "The dashboard rejected the pairing (expired or already used). Create a new pairing.",
  rejected: "The dashboard did not accept these cookies. Sign in to the provider again and create a new pairing.",
  forbidden: "The dashboard refused the request (HTTPS is required, or the login host was used). Create a new pairing.",
  target_missing: "The target connection no longer exists. Create a new pairing.",
  conflict: "The dashboard reported a conflict (for example the connection name already exists). Create a new pairing.",
  server_error: "The dashboard could not save the connection. Create a new pairing to try again.",
  unexpected_status: "The dashboard answered unexpectedly. Create a new pairing to try again.",
});

const fail = (code, extra) => ({ ok: false, code, message: MESSAGES[code], ...extra });
// WordPress core: LOGGED_IN_COOKIE is `wordpress_logged_in_` . COOKIEHASH, COOKIEHASH = md5(siteurl).
const MD5_HEX_SUFFIX_RE = /^[0-9a-f]{32}$/;
const hashedMember = (prefix, name) => isString(name) && name.startsWith(prefix) && MD5_HEX_SUFFIX_RE.test(name.slice(prefix.length));
/** True when the plan reads at least one cookie (fixed name or hashed family). */
const planUsesCookies = (plan) => plan.cookieNames.length > 0 || (plan.hashedCookiePrefixes?.length ?? 0) > 0;
const matchPattern = (origin) => { const u = new URL(origin); return `${u.protocol}//${u.hostname}/*`; };

function originOf(value) {
  try { return new URL(value).origin; } catch { return null; }
}

/** The one address cookies may be posted to: HTTPS, or plain http to loopback, exact import path, nothing else. */
function parseDestination(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  const secure = url.protocol === "https:";
  const loopback = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  if (!secure && !loopback) return null;
  if (url.username || url.password || url.search || url.hash || url.pathname !== IMPORT_PATH) return null;
  if (Object.values(PROVIDERS).some((p) => p.origin === url.origin)) return null;
  return { origin: url.origin, url: `${url.origin}${IMPORT_PATH}` };
}

/**
 * Validate the pairing the operator pasted and bind it to the built-in table.
 * @returns {{ ok: true, plan: object } | { ok: false, code: string, message: string }}
 */
export function parsePairing(text, now = Date.now()) {
  if (!isString(text) || !text.trim() || text.length > MAX_PAIRING_TEXT) return fail("invalid_pairing");
  let raw;
  try { raw = JSON.parse(text); } catch { return fail("invalid_pairing"); }
  const pairing = isRecord(raw) && isRecord(raw.pairing) ? raw.pairing : raw;
  if (!isRecord(pairing)) return fail("invalid_pairing");

  if (!isString(pairing.provider) || !Object.hasOwn(PROVIDERS, pairing.provider)) return fail("unsupported_provider");
  const def = PROVIDERS[pairing.provider];
  if (!isString(pairing.token) || !PAIRING_TOKEN_RE.test(pairing.token) || pairing.header !== PAIRING_HEADER) return fail("invalid_pairing");

  let target;
  if (pairing.action === "create" && isString(pairing.name) && pairing.name.trim() && pairing.name.length <= MAX_TARGET_LENGTH && pairing.connectionId === undefined) {
    target = { action: "create", name: pairing.name };
  } else if (pairing.action === "update" && isString(pairing.connectionId) && pairing.connectionId && pairing.connectionId.length <= MAX_TARGET_LENGTH && pairing.name === undefined) {
    target = { action: "update", connectionId: pairing.connectionId };
  } else {
    return fail("invalid_pairing");
  }

  const destination = parseDestination(pairing.importUrl);
  if (!destination) return fail("invalid_destination");

  const contract = pairing.contract;
  if (!isRecord(contract) || contract.extensionCapture === false || !Array.isArray(contract.cookieNames)) return fail("invalid_pairing");
  if (contract.origin !== def.origin) return fail("origin_mismatch");
  // A pairing may only narrow the built-in allowlist.
  const cookieNames = def.cookieNames.filter((name) => contract.cookieNames.includes(name));
  const prefixes = Array.isArray(contract.cookiePrefixes) ? contract.cookiePrefixes : [];
  const cookiePrefixes = def.cookiePrefixes.filter((prefix) => prefixes.includes(prefix));
  if (cookieNames.length !== def.cookieNames.length) return fail("invalid_pairing");
  // Hashed families are required like cookie names: the pairing must carry every built-in one.
  const builtInHashed = def.hashedCookiePrefixes ?? [];
  const pairedHashed = Array.isArray(contract.hashedCookiePrefixes) ? contract.hashedCookiePrefixes : [];
  const hashedCookiePrefixes = builtInHashed.filter((prefix) => pairedHashed.includes(prefix));
  if (hashedCookiePrefixes.length !== builtInHashed.length) return fail("invalid_pairing");
  // Optional cookies are never required: a pairing that omits them (an older dashboard) simply narrows them away.
  const pairedOptional = Array.isArray(contract.optionalCookies) ? contract.optionalCookies : [];
  const optionalCookies = (def.optionalCookies ?? []).filter((name) => pairedOptional.includes(name));
  const builtInKeys = def.localStorageKeys ?? [];
  const pairedKeys = Array.isArray(contract.localStorageKeys) ? contract.localStorageKeys : [];
  const localStorageKeys = builtInKeys.filter((key) => pairedKeys.includes(key));
  if (localStorageKeys.length !== builtInKeys.length) return fail("invalid_pairing");

  const expiresAt = isString(pairing.expiresAt) ? Date.parse(pairing.expiresAt) : NaN;
  if (!Number.isFinite(expiresAt) || expiresAt - now > MAX_PAIRING_LIFETIME_MS) return fail("invalid_pairing");
  if (expiresAt <= now) return fail("pairing_expired");

  return {
    ok: true,
    plan: {
      provider: pairing.provider,
      label: def.label,
      providerOrigin: def.origin,
      dashboardOrigin: destination.origin,
      importUrl: destination.url,
      cookieNames,
      cookiePrefixes,
      hashedCookiePrefixes,
      optionalCookies,
      localStorageKeys,
      expiresAt,
      token: pairing.token,
      ...target,
    },
  };
}

/** Everything the confirmation screen may show. Never the secret. */
export function describePlan(plan) {
  return {
    provider: plan.provider,
    label: plan.label,
    providerOrigin: plan.providerOrigin,
    dashboardOrigin: plan.dashboardOrigin,
    action: plan.action,
    target: plan.action === "create" ? plan.name : plan.connectionId,
    cookieNames: [
      ...plan.cookieNames,
      ...plan.cookiePrefixes.map((prefix) => `${prefix}<n>`),
      ...(plan.hashedCookiePrefixes ?? []).map((prefix) => `${prefix}<md5>`),
    ],
    optionalCookies: [...(plan.optionalCookies ?? [])],
    localStorageKeys: [...(plan.localStorageKeys ?? [])],
  };
}

/** The exact statement the user confirms; `runCapture` refuses anything else. */
export function confirmationFor(plan) {
  return { provider: plan.provider, providerOrigin: plan.providerOrigin, dashboardOrigin: plan.dashboardOrigin };
}

/**
 * Parse the pairing and check that the active tab is the provider site.
 * Reads no cookie and makes no request.
 */
export async function prepareCapture({ chrome, text, now = Date.now() }) {
  const parsed = parsePairing(text, now);
  if (!parsed.ok) return parsed;
  let tab = null;
  try { [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); } catch { /* handled as a wrong tab */ }
  if (!tab || !isNumber(tab.id) || originOf(tab.url) !== parsed.plan.providerOrigin) {
    return fail("wrong_tab", { expectedOrigin: parsed.plan.providerOrigin });
  }
  parsed.plan.tabId = tab.id;
  try {
    await preflightPermissions(chrome, parsed.plan);
  } catch {
    return fail("permission_denied");
  }
  return parsed;
}

const spentPlans = new WeakSet();
const permissionPlans = new WeakMap();

/** Snapshot existing grants during Review, before the confirmed Send gesture. */
export async function preflightPermissions(chrome, plan) {
  const missing = { permissions: [], origins: [] };
  const origins = [matchPattern(plan.providerOrigin), matchPattern(plan.dashboardOrigin)];
  // Each API is asked for only when the provider's credential needs it.
  const needed = [...(planUsesCookies(plan) ? ["cookies"] : []), ...(plan.localStorageKeys?.length ? ["scripting"] : [])];
  for (const permission of needed) {
    if (!(await chrome.permissions.contains({ permissions: [permission] }))) missing.permissions.push(permission);
  }
  for (const origin of new Set(origins)) {
    if (!(await chrome.permissions.contains({ origins: [origin] }))) missing.origins.push(origin);
  }
  permissionPlans.set(plan, missing);
}

function cookieHostAllowed(host, domain) {
  if (!isString(domain)) return false;
  const d = domain.replace(/^\./, "").toLowerCase();
  return d.includes(".") && (host === d || host.endsWith(`.${d}`));
}

/** The submitted shape of a browser cookie, or null unless it is a secure, non-empty cookie of `host`. */
function approvedCookie(cookie, host) {
  if (!isRecord(cookie) || cookie.secure !== true || !isString(cookie.value) || !cookie.value || !cookieHostAllowed(host, cookie.domain)) return null;
  const out = { name: cookie.name, value: cookie.value, domain: cookie.domain.replace(/^\./, ""), secure: true };
  if (isNumber(cookie.expirationDate)) out.expirationDate = cookie.expirationDate;
  return out;
}

/** One bounded enumeration for built-in hashed families; unrelated values are never inspected. */
async function readHashedFamily(chrome, plan, storeId, cancelled, now) {
  if (!(await tabOnProvider(chrome, plan))) return { cookies: [], navigated: true };
  const entries = await chrome.cookies.getAll({ url: plan.providerOrigin + "/", storeId });
  if (!(await tabOnProvider(chrome, plan))) return { cookies: [], navigated: true };
  if (cancelled() || !Array.isArray(entries) || entries.length > 64) return { cookies: [] };
  const cookies = [];
  const host = new URL(plan.providerOrigin).hostname;
  for (const prefix of plan.hashedCookiePrefixes) {
    const members = [];
    for (const entry of entries) {
      if (!isRecord(entry) || !hashedMember(prefix, entry.name)) continue;
      if (entry.storeId !== storeId || (entry.expirationDate !== undefined &&
        (!isNumber(entry.expirationDate) || entry.expirationDate * 1000 <= now()))) continue;
      const cookie = approvedCookie(entry, host);
      if (cookie) members.push(cookie);
    }
    if (members.length > 1) return { cookies: [], ambiguous: true };
    if (!members.length) return { cookies: [] };
    cookies.push(members[0]);
  }
  return { cookies };
}

/** @returns {Promise<{ cookies: object[], ambiguous: boolean }>} */
async function readApprovedCookies(chrome, plan, storeId, cancelled) {
  const url = `${plan.providerOrigin}/`;
  const host = new URL(plan.providerOrigin).hostname;
  const found = [];
  const take = async (name) => {
    const cookie = await chrome.cookies.get({ url, name, storeId });
    if (cancelled() || !cookie) return null;
    // Only secure cookies of this host, under exactly the requested name.
    if (cookie.name !== name) return null;
    const out = approvedCookie(cookie, host);
    if (out) found.push(out);
    return out;
  };
  const done = (ambiguous = false) => ({ cookies: ambiguous ? [] : found, ambiguous });
  for (const name of plan.cookieNames) {
    await take(name);
    if (cancelled()) return done();
  }
  // Optional cookies are read the same way but their absence is not an error.
  for (const name of plan.optionalCookies ?? []) {
    await take(name);
    if (cancelled()) return done();
  }
  for (const prefix of plan.cookiePrefixes) {
    // Chunks are contiguous from .0; stop at the first gap.
    for (let index = 0; index < MAX_COOKIES && found.length < MAX_COOKIES; index += 1) {
      if (!(await take(`${prefix}${index}`)) || cancelled()) break;
    }
  }
  return done();
}

/**
 * Injected into the confirmed provider tab by `chrome.scripting.executeScript`. It runs in the
 * page's origin, reads only the item names it is given and changes nothing.
 * The second argument is the provider origin the user confirmed. The reader answers nothing
 * unless the page's own `location.origin` is exactly that origin, so a tab that navigated
 * elsewhere after Send cannot hand over another site's value. It is read from `arguments` so
 * the serialized signature stays `(keys)`.
 * Self-contained on purpose: it is serialized, so it cannot close over module state.
 */
export function readLocalStorageItems(keys) {
  const expectedOrigin = arguments[1];
  const found = {};
  // Strict equality with the page's origin string: a missing or non-string origin never matches.
  if (!expectedOrigin || globalThis.location?.origin !== expectedOrigin) return found;
  for (const key of keys) {
    const value = globalThis.localStorage.getItem(key);
    // getItem answers a string or null.
    if (value !== null && value !== "") found[key] = value;
  }
  return found;
}

const LOCAL_VALUE_RE = /^[\x21-\x7e]{1,8192}$/;

/** True when the confirmed tab still shows the provider origin. */
async function tabOnProvider(chrome, plan) {
  let tab = null;
  try { tab = await chrome.tabs.get(plan.tabId); } catch { /* treated as navigated away */ }
  return Boolean(tab) && originOf(tab.url) === plan.providerOrigin;
}

/**
 * Read the approved items from the confirmed tab. The tab URL is checked right before and right
 * after the injection, and the reader itself checks the page origin, so a navigation at any point
 * yields `tab_navigated` instead of a value.
 * @returns {Promise<{ ok: true, values: Record<string, string> } | { ok: false }>}
 */
async function readApprovedLocalStorage(chrome, plan) {
  if (!(await tabOnProvider(chrome, plan))) return { ok: false };
  const results = await chrome.scripting.executeScript({
    target: { tabId: plan.tabId }, func: readLocalStorageItems, args: [[...plan.localStorageKeys], plan.providerOrigin],
  });
  if (!(await tabOnProvider(chrome, plan))) return { ok: false };
  // Only the top frame of the confirmed tab counts.
  const top = Array.isArray(results) ? results.find((entry) => isRecord(entry) && entry.frameId === 0) : null;
  const items = isRecord(top?.result) ? top.result : {};
  const values = {};
  for (const key of plan.localStorageKeys) {
    if (isString(items[key]) && LOCAL_VALUE_RE.test(items[key])) values[key] = items[key];
  }
  return { ok: true, values };
}

function statusCode(status) {
  if (status === 400) return "rejected";
  if (status === 401) return "pairing_rejected";
  if (status === 403) return "forbidden";
  if (status === 404) return "target_missing";
  if (status === 409) return "conflict";
  if (status === 413 || status === 415) return "rejected";
  if (status >= 500) return "server_error";
  return "unexpected_status";
}

/**
 * Run one confirmed capture: permissions, read, one POST, cleanup.
 * @param {object} args
 * @param {object} args.chrome       chrome.* namespace (promise API)
 * @param {Function} args.fetch      fetch implementation
 * @param {object} args.plan         from `prepareCapture`
 * @param {object} args.confirmed    must equal `confirmationFor(plan)`
 * @param {AbortSignal} [args.signal]
 * @param {() => number} [args.now]
 */
export async function runCapture({ chrome, fetch, plan, confirmed, signal, now = Date.now }) {
  const expected = confirmationFor(plan);
  if (!isRecord(confirmed) || Object.keys(expected).some((key) => confirmed[key] !== expected[key])) return fail("not_confirmed");
  if (spentPlans.has(plan)) return fail("already_used");
  if (plan.expiresAt <= now()) return fail("pairing_expired");
  const cancelled = () => signal?.aborted === true;
  if (cancelled()) return fail("cancelled");

  const missing = permissionPlans.get(plan);
  if (!missing) return fail("permission_denied");
  const granted = { permissions: [], origins: [] };
  try {
    // Request synchronously within Send; Review already identified the missing grants.
    if (missing.permissions.length || missing.origins.length) {
      let ok = false;
      try { ok = (await chrome.permissions.request(missing)) === true; } catch { ok = false; }
      if (!ok) return cancelled() ? fail("cancelled") : fail("permission_denied");
      granted.permissions = missing.permissions;
      granted.origins = missing.origins;
    }
    if (cancelled()) return fail("cancelled");
    if (plan.expiresAt <= now()) return fail("pairing_expired");

    // Re-check the tab: the user may have navigated while the prompt was open.
    let tab = null;
    try { tab = await chrome.tabs.get(plan.tabId); } catch { /* wrong tab */ }
    if (cancelled()) return fail("cancelled");
    if (!tab || originOf(tab.url) !== plan.providerOrigin) return fail("wrong_tab", { expectedOrigin: plan.providerOrigin });

    // Grants can change after Review; refresh the snapshot for a subsequent Send.
    const permissionsAvailable = async () => {
      try {
        await preflightPermissions(chrome, plan);
        const current = permissionPlans.get(plan);
        return !current.permissions.length && !current.origins.length;
      } catch { return false; }
    };
    if (!(await permissionsAvailable())) return cancelled() ? fail("cancelled") : fail("permission_denied");
    if (cancelled()) return fail("cancelled");

    let cookies = [];
    let ambiguousCookies = false;
    if (planUsesCookies(plan)) {
      // The session is the cookie store that owns this tab (normal, incognito, container).
      let stores;
      try { stores = await chrome.cookies.getAllCookieStores(); }
      catch { await permissionsAvailable(); return cancelled() ? fail("cancelled") : fail("permission_denied"); }
      const store = Array.isArray(stores) ? stores.find((s) => Array.isArray(s.tabIds) && s.tabIds.includes(plan.tabId)) : null;
      if (cancelled()) return fail("cancelled");
      if (!store) return fail("no_cookie_store");

      try { ({ cookies, ambiguous: ambiguousCookies } = await readApprovedCookies(chrome, plan, store.id, cancelled)); }
      catch { await permissionsAvailable(); return cancelled() ? fail("cancelled") : fail("permission_denied"); }
      if (plan.hashedCookiePrefixes?.length) {
        let read;
        try { read = await readHashedFamily(chrome, plan, store.id, cancelled, now); }
        catch { await permissionsAvailable(); return cancelled() ? fail("cancelled") : fail("permission_denied"); }
        if (cancelled()) return fail("cancelled");
        if (read.navigated) return fail("tab_navigated");
        cookies = read.cookies;
        ambiguousCookies = read.ambiguous;
      }
      if (cancelled()) return fail("cancelled");
    }

    let localStorage = null;
    if (plan.localStorageKeys?.length) {
      let read;
      try { read = await readApprovedLocalStorage(chrome, plan); }
      catch { await permissionsAvailable(); return cancelled() ? fail("cancelled") : fail("permission_denied"); }
      if (cancelled()) return fail("cancelled");
      if (!read.ok) return fail("tab_navigated", { expectedOrigin: plan.providerOrigin });
      localStorage = read.values;
    }
    if (!(await permissionsAvailable())) return cancelled() ? fail("cancelled") : fail("permission_denied");
    if (cancelled()) return fail("cancelled");
    if (ambiguousCookies) return fail("ambiguous_cookies");
    if (planUsesCookies(plan) && cookies.length === 0) return fail("no_cookies");
    if (localStorage && Object.keys(localStorage).length !== plan.localStorageKeys.length) return fail("no_local_storage");

    const body = { provider: plan.provider, origin: plan.providerOrigin };
    if (planUsesCookies(plan)) body.cookies = cookies;
    if (localStorage) body.localStorage = localStorage;
    if (plan.action === "update") body.connectionId = plan.connectionId;

    // From here the secret is spent, whatever the outcome.
    spentPlans.add(plan);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
    const abortedResult = {};
    let resolveAbort;
    const aborted = new Promise((resolve) => { resolveAbort = resolve; });
    const onRequestAbort = () => resolveAbort(abortedResult);
    controller.signal.addEventListener("abort", onRequestAbort, { once: true });
    try {
      let response;
      try {
        response = await fetch(plan.importUrl, {
        method: "POST",
        headers: { "content-type": "application/json", [PAIRING_HEADER]: plan.token },
        body: JSON.stringify(body),
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
        });
      } catch {
        return timedOut ? fail("network_error") : cancelled() ? fail("cancelled") : fail("network_error");
      }
      if (response.status !== 200 && response.status !== 201) return fail(statusCode(response.status));
      let connection = null;
      try {
        const bodyResult = await Promise.race([response.json(), aborted]);
        if (bodyResult === abortedResult) return timedOut ? fail("network_error") : fail("cancelled");
        connection = bodyResult?.connection ?? null;
      }
      catch {
        if (timedOut) return fail("network_error");
        if (cancelled()) return fail("cancelled");
        // The import itself succeeded; unreadable response bodies are still success.
      }
      return {
        ok: true,
        action: plan.action,
        cookieCount: cookies.length,
        ...(localStorage ? { localStorageCount: Object.keys(localStorage).length } : null),
        connection: isRecord(connection) ? { id: String(connection.id ?? ""), name: String(connection.name ?? "") } : null,
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      controller.signal.removeEventListener("abort", onRequestAbort);
      plan.token = "";
    }
  } finally {
    // Give back what this run was granted. Failures here are not actionable.
    if (granted.permissions.length || granted.origins.length) {
      try {
        if (await chrome.permissions.remove(granted)) {
          const current = permissionPlans.get(plan);
          permissionPlans.set(plan, {
            permissions: [...new Set([...current.permissions, ...granted.permissions])],
            origins: [...new Set([...current.origins, ...granted.origins])],
          });
        }
      } catch { /* nothing to do */ }
    }
  }
}
