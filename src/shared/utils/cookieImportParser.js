/**
 * Local parsers for the dashboard cookie import UI.
 *
 * The operator can hand DurinDoor a session in three shapes: a raw `Cookie`
 * header, a cURL command copied from the browser, or a HAR file exported from
 * the browser's network tools. All three are parsed here, in the browser, as
 * plain data: nothing is executed, no request is sent to the URL in the input
 * and the HAR file never leaves the machine.
 *
 * The parsers only decide what the input *says*. Which origins and cookie
 * names the provider approves comes from the shared contract
 * (@/shared/utils/cookieImportContract.js), and the server applies the same
 * rules again before it stores anything.
 */

import { isString, isNumber, isBoolean } from "./typeChecks.js";
import {
  MAX_IMPORT_COOKIES,
  isApprovedCookieName,
  isValidCookieName,
  isValidCookieValue,
  cookieChunkIndex,
  cookieDomainAllowed,
  hashedCookiePrefixOf,
} from "./cookieImportContract";

/** A pasted header or cURL command may not exceed this size. */
export const MAX_IMPORT_TEXT_LENGTH = 64 * 1024;
/** A HAR file is read locally and may not exceed this size. */
export const MAX_HAR_FILE_BYTES = 4 * 1024 * 1024;
/** Guard against a HAR file with an unreasonable number of entries. */
export const MAX_HAR_ENTRIES = 5000;

const COOKIE_HEADER_RE = /^\s*cookie\s*:\s*/i;
const HTTP_URL_RE = /^https?:\/\//i;
const CURL_FLAGS_WITH_VALUE = new Set([
  "-H", "--header", "-d", "--data", "--data-raw", "--data-binary", "--data-urlencode",
  "-X", "--request", "-A", "--user-agent", "-b", "--cookie", "-e", "--referer",
  "-u", "--user", "-o", "--output", "-x", "--proxy", "-m", "--max-time",
  "--connect-timeout", "-T", "--upload-file", "-F", "--form", "--oauth2-bearer",
]);

function fail(error) {
  return { ok: false, error };
}

/**
 * Split a cookie header into name/value pairs.
 *
 * Values keep every `=` they carry (base64 padding), because a truncated
 * session token is a broken session. Parts that are not `name=value` pairs,
 * names that are not tokens and empty values are dropped and counted.
 *
 * @param {string} raw
 * @returns {{ ok: true, cookies: { name: string, value: string }[], skipped: number } | { ok: false, error: string }}
 */
export function parseCookieHeaderValue(raw) {
  if (!isString(raw)) return fail("No cookie header was provided.");
  const text = raw.replace(COOKIE_HEADER_RE, "").trim();
  if (!text) return fail("No cookie header was provided.");
  const cookies = [];
  const seen = new Set();
  let skipped = 0;
  for (const part of text.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      skipped += 1;
      continue;
    }
    const name = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!isValidCookieName(name) || !value || seen.has(name)) {
      skipped += 1;
      continue;
    }
    seen.add(name);
    cookies.push({ name, value });
  }
  if (!cookies.length) return fail("No cookie name=value pair was found in the input.");
  return { ok: true, cookies, skipped };
}

/**
 * Split a shell command into tokens, honouring single and double quotes, the
 * `$'...'` spelling and backslash line continuations. The command is only read,
 * never run.
 *
 * @param {string} raw
 * @returns {string[]}
 */
export function tokenizeCommand(raw) {
  const tokens = [];
  let current = "";
  let quote = null;
  let started = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (quote) {
      if (char === "\\" && quote === '"' && index + 1 < raw.length) {
        current += raw[index + 1];
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }
    if (char === "\\" && (raw[index + 1] === "\n" || raw[index + 1] === "\r")) {
      index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
      continue;
    }
    if (char === "$" && (raw[index + 1] === "'" || raw[index + 1] === '"')) {
      quote = raw[index + 1];
      started = true;
      index += 1;
      continue;
    }
    if (/\s/.test(char)) {
      if (started || current) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }
  if (started || current) tokens.push(current);
  return tokens;
}

/**
 * Read the URL and the cookie header out of a pasted cURL command.
 *
 * The command is treated as text: it is tokenized and read, never executed,
 * and the URL it names is never requested.
 *
 * @param {string} raw
 * @returns {{ ok: true, url: string, origin: string, cookies: { name: string, value: string }[], skipped: number } | { ok: false, error: string }}
 */
export function parseCurlCommand(raw) {
  if (!isString(raw)) return fail("No cURL command was provided.");
  const text = raw.trim();
  if (!text) return fail("No cURL command was provided.");
  if (text.length > MAX_IMPORT_TEXT_LENGTH) return fail("The cURL command is too large.");
  const tokens = tokenizeCommand(text);
  if (!tokens.length || !/^curl(\.exe)?$/i.test(tokens[0])) {
    return fail("This does not look like a cURL command.");
  }
  let url = "";
  let cookieHeader = "";
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "-H" || token === "--header") {
      const value = tokens[index + 1];
      index += 1;
      if (isString(value) && /^\s*cookie\s*:/i.test(value)) cookieHeader = value.replace(COOKIE_HEADER_RE, "");
      continue;
    }
    if (token === "-b" || token === "--cookie") {
      const value = tokens[index + 1];
      index += 1;
      // `-b` also names a cookie jar file; only an inline `name=value` pair is a credential.
      if (isString(value) && value.includes("=") && !cookieHeader) cookieHeader = value;
      continue;
    }
    if (token.startsWith("-")) {
      if (CURL_FLAGS_WITH_VALUE.has(token)) index += 1;
      continue;
    }
    if (!url && HTTP_URL_RE.test(token)) {
      url = token;
      continue;
    }
  }
  if (!url) return fail("The cURL command does not name an http or https URL.");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return fail("The cURL command does not name an http or https URL.");
  }
  if (parsed.username || parsed.password) return fail("The cURL command URL carries credentials in its authority.");
  if (!cookieHeader) return fail("The cURL command has no Cookie header.");
  const cookies = parseCookieHeaderValue(cookieHeader);
  if (!cookies.ok) return cookies;
  return { ok: true, url: parsed.href, origin: parsed.origin, cookies: cookies.cookies, skipped: cookies.skipped };
}

/**
 * Scope/expiry evidence for entries returned by parseHarDocument, keyed by entry object.
 * Entries built or cloned elsewhere carry none and are treated like raw Cookie headers.
 * @type {WeakMap<object, { invalid: boolean, expiry: Map<string, number> }>}
 */
const HAR_EVIDENCE = new WeakMap();

/**
 * Read the request origins and cookies out of a HAR file.
 *
 * Only the request URL and its own header and cookie fields are read. The file
 * stays in the browser: it is never uploaded. Explicit scope and expiry metadata
 * must be applicable and fresh; a repeated header cannot erase it. The returned entry
 * shape is unchanged ({ name, value } cookies); the evidence is kept privately and
 * applied by buildImportCandidates, which refuses an entry whose explicit metadata is
 * expired, malformed or out of scope and forwards fresh expiry as `expirationDate`.
 * Session cookies without expiry remain usable. Raw headers (including header-only HAR
 * requests) carry no domain/path/expiry evidence beyond the request URL; no expiry is invented.
 *
 * @param {string} raw HAR file contents
 * @returns {{ ok: true, entries: { origin: string, url: string, cookies: { name: string, value: string }[] }[] } | { ok: false, error: string }}
 */
export function parseHarDocument(raw) {
  if (!isString(raw)) return fail("The HAR file could not be read.");
  if (raw.length > MAX_HAR_FILE_BYTES) return fail("The HAR file is too large.");
  let document;
  try {
    document = JSON.parse(raw);
  } catch {
    return fail("The HAR file is not valid JSON.");
  }
  const entries = document?.log?.entries;
  if (!Array.isArray(entries)) return fail("The HAR file has no request entries.");
  if (entries.length > MAX_HAR_ENTRIES) return fail("The HAR file has too many request entries.");
  const parsed = [];
  for (const entry of entries) {
    const request = entry?.request;
    let url;
    try {
      url = new URL(request?.url);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) continue;
    // Public entry shape stays { name, value }; scope and expiry evidence lives beside it.
    const cookies = new Map();
    const expiry = new Map();
    let invalid = false;
    const requestCookies = Array.isArray(request?.cookies) ? request.cookies : [];
    for (const cookie of requestCookies) {
      if (!isValidCookieName(cookie?.name)) continue;
      if (!isValidCookieValue(cookie?.value)) invalid = true;
      if (!isString(cookie?.value) || !cookie.value) continue;
      // Explicit metadata must be valid and applicable to this request. A repeated
      // raw header must not erase a rejected structured cookie's expiry or scope.
      if (cookies.has(cookie.name)) invalid = true;
      if (cookie.domain !== undefined && !cookieDomainAllowed(url.hostname, cookie.domain)) invalid = true;
      if (cookie.path !== undefined && (!isString(cookie.path) || !cookie.path.startsWith("/") ||
        !(url.pathname === cookie.path || (url.pathname.startsWith(cookie.path) && (cookie.path.endsWith("/") || url.pathname[cookie.path.length] === "/"))))) invalid = true;
      if (cookie.secure !== undefined && (!isBoolean(cookie.secure) || (cookie.secure && url.protocol !== "https:"))) invalid = true;
      for (const key of ["expires", "expirationDate", "expiry"]) {
        if (!Object.hasOwn(cookie, key)) continue;
        const value = cookie[key];
        const seconds = key === "expires" && isString(value) && value.trim() ? Date.parse(value) / 1000 : value;
        if (!isNumber(seconds) || !Number.isFinite(seconds) || seconds * 1000 <= Date.now()) invalid = true;
        else expiry.set(cookie.name, Math.min(expiry.get(cookie.name) ?? Infinity, seconds));
      }
      cookies.set(cookie.name, cookie.value);
    }
    const headers = Array.isArray(request?.headers) ? request.headers : [];
    for (const header of headers) {
      if (String(header?.name || "").toLowerCase() !== "cookie") continue;
      const parsedHeader = parseCookieHeaderValue(String(header?.value || ""));
      if (!parsedHeader.ok) continue;
      for (const cookie of parsedHeader.cookies) {
        if (cookies.has(cookie.name) && cookies.get(cookie.name) !== cookie.value) invalid = true;
        cookies.set(cookie.name, cookie.value);
      }
    }
    const parsedEntry = { origin: url.origin, url: url.href, cookies: [...cookies].map(([name, value]) => ({ name, value })) };
    HAR_EVIDENCE.set(parsedEntry, { invalid, expiry });
    parsed.push(parsedEntry);
  }
  if (!parsed.length) return fail("The HAR file has no usable request entries.");
  return { ok: true, entries: parsed };
}

/**
 * True when two candidates carry the same cookies, in the same order.
 * @param {{ name: string }[]} first
 * @param {{ name: string }[]} second
 */
function sameCookieSet(first, second) {
  if (first.length !== second.length) return false;
  return first.every((cookie, index) => cookie.name === second[index]?.name && cookie.value === second[index]?.value);
}

/**
 * Approved cookies of one candidate, with the unapproved ones dropped.
 *
 * A chunked session cookie keeps every chunk; when the chunks are present the
 * stale unchunked copy is dropped, exactly as the stored header does. A gap in
 * the chunk sequence is an error: the session would be incomplete.
 *
 * @param {{ origin: string, url: string|null, cookies: { name: string, value: string }[] }} candidate
 * @param {object} contract shared import contract
 * @returns {{ ok: true, cookies: { name: string, value: string }[], dropped: string[] } | { ok: false, error: string }}
 */
export function filterCandidateCookies(candidate, contract) {
  const kept = [];
  const dropped = [];
  const seen = new Set();
  for (const cookie of candidate.cookies) {
    const prefix = contract.cookiePrefixes.find((prefix) => cookie.name.startsWith(prefix));
    if (prefix && (!/^(0|[1-9][0-9]*)$/.test(cookie.name.slice(prefix.length)) ||
      !Number.isSafeInteger(Number(cookie.name.slice(prefix.length))) || Number(cookie.name.slice(prefix.length)) >= MAX_IMPORT_COOKIES)) return fail("The chunked cookie has an invalid index.");
    if (!isApprovedCookieName(contract, cookie.name)) continue;
    if (seen.has(cookie.name) || !isValidCookieValue(cookie.value)) return fail("The approved cookie is duplicated or invalid.");
    seen.add(cookie.name);
    if (cookie.expirationDate !== undefined && (!Number.isFinite(cookie.expirationDate) || cookie.expirationDate * 1000 <= Date.now())) return fail("The approved cookie has expired or has invalid expiry metadata.");
  }
  for (const cookie of candidate.cookies) {
    if (!isApprovedCookieName(contract, cookie.name) || !isValidCookieValue(cookie.value)) {
      dropped.push(cookie.name);
      continue;
    }
    kept.push(cookie);
  }
  const byName = new Map();
  for (const cookie of kept) byName.set(cookie.name, cookie);
  const final = [];
  for (const base of contract.cookieNames) {
    const chunks = kept
      .map((cookie) => ({ cookie, index: cookieChunkIndex(contract, base, cookie.name) }))
      .filter((entry) => entry.index !== null)
      .sort((left, right) => left.index - right.index);
    if (!chunks.length) {
      const single = byName.get(base);
      if (!single) return fail(`The input has no ${base} cookie.`);
      final.push(single);
      continue;
    }
    const gap = chunks.findIndex((entry, position) => entry.index !== position);
    if (gap !== -1) return fail(`The chunked ${base} cookie is incomplete: chunk ${gap} is missing.`);
    for (const entry of chunks) final.push(entry.cookie);
  }
  // A hashed family (WordPress `wordpress_logged_in_<md5>`) needs exactly one member: two
  // different digests mean two site sessions, and the operator has to pick the right input.
  for (const prefix of contract.hashedCookiePrefixes ?? []) {
    const members = [...byName.values()].filter((cookie) => hashedCookiePrefixOf(contract, cookie.name) === prefix);
    if (!members.length) return fail(`The input has no ${prefix}<md5> cookie.`);
    if (members.length > 1) return fail(`The input has more than one ${prefix}<md5> cookie; keep only the session you want.`);
    final.push(members[0]);
  }
  // Optional cookies ride along when present; their absence is never an error.
  for (const name of contract.optionalCookies ?? []) {
    const optional = byName.get(name);
    if (optional && !final.includes(optional)) final.push(optional);
  }
  if (!final.length) return fail("The input has no cookie this provider approves.");
  if (final.length > MAX_IMPORT_COOKIES) return fail("The input has more cookies than a connection may hold.");
  return { ok: true, cookies: final, dropped };
}

/**
 * Turn a parsed input into the candidates the operator can choose from.
 *
 * Only the provider origin and the provider's approved cookies survive; every
 * other request origin in a HAR file is ignored. A cURL command for another
 * origin is refused instead, because there is nothing to choose from.
 *
 * @param {{ kind: "header" | "curl" | "har", parsed: object }} input
 * @param {object} contract shared import contract
 * @returns {{ ok: true, candidates: object[] } | { ok: false, error: string }}
 */
export function buildImportCandidates(input, contract) {
  if (!contract) return fail("This provider does not support cookie import.");
  if (input?.kind === "header") {
    const filtered = filterCandidateCookies({ origin: contract.origin, url: null, cookies: input.parsed.cookies }, contract);
    if (!filtered.ok) return filtered;
    return { ok: true, candidates: [{ origin: contract.origin, originKnown: false, url: null, cookies: filtered.cookies, dropped: filtered.dropped }] };
  }
  if (input?.kind === "curl") {
    if (input.parsed.origin !== contract.origin) {
      return fail("The request origin is not approved for this provider.");
    }
    const filtered = filterCandidateCookies({ origin: contract.origin, url: input.parsed.url, cookies: input.parsed.cookies }, contract);
    if (!filtered.ok) return filtered;
    return { ok: true, candidates: [{ origin: contract.origin, originKnown: true, url: input.parsed.url, cookies: filtered.cookies, dropped: filtered.dropped }] };
  }
  if (input?.kind === "har") {
    const candidates = [];
    for (const entry of input.parsed.entries ?? []) {
      if (entry.origin !== contract.origin) continue;
      const evidence = HAR_EVIDENCE.get(entry);
      if (evidence?.invalid) continue;
      const withExpiry = evidence?.expiry.size
        ? { ...entry, cookies: entry.cookies.map((cookie) => evidence.expiry.has(cookie.name) ? { ...cookie, expirationDate: evidence.expiry.get(cookie.name) } : cookie) }
        : entry;
      const filtered = filterCandidateCookies(withExpiry, contract);
      if (!filtered.ok) continue;
      candidates.push({ origin: contract.origin, originKnown: true, url: entry.url, cookies: filtered.cookies, dropped: filtered.dropped });
    }
    if (!candidates.length) return fail(`The HAR file has no request to ${contract.origin}.`);
    return { ok: true, candidates };
  }
  return fail("The input could not be read.");
}

/**
 * True when the candidates carry different credentials, so the operator has to
 * pick one. Requests that all carry the same cookies are not ambiguous.
 * @param {object[]} candidates
 */
export function candidatesAreAmbiguous(candidates) {
  if (!Array.isArray(candidates) || candidates.length < 2) return false;
  const [first, ...rest] = candidates;
  return rest.some((candidate) => !sameCookieSet(first.cookies, candidate.cookies));
}
