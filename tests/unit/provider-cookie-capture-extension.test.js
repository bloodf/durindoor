/**
 * Provider cookie capture extension (extensions/provider-cookie-capture).
 *
 * Closed mocks only: a fake `chrome` namespace, a fake `fetch`, synthetic
 * credentials. No browser, no network, no provider.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { crc32 } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";

import { PROVIDERS, PAIRING_HEADER, MAX_COOKIES } from "../../extensions/provider-cookie-capture/providers.js";
import {
  MESSAGES, parsePairing, prepareCapture, preflightPermissions, runCapture, describePlan, confirmationFor,
} from "../../extensions/provider-cookie-capture/capture.js";
import { mountPopup } from "../../extensions/provider-cookie-capture/popup.js";
import { getCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";
import { PACKAGE_FILES, buildPackage, EXTENSION_DIR } from "../../scripts/package-cookie-extension.mjs";

const REPO = path.resolve(import.meta.dirname, "../..");
const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
// Synthetic only: none of these is a real credential.
const TOKEN = `ddpair_${"A".repeat(43)}`;
const VALUE = "synthetic-session-value";
const CHUNK0 = "synthetic-chunk-zero";
const CHUNK1 = "synthetic-chunk-one";
const NOISE = "synthetic-unapproved-value";
const DASHBOARD = "https://dashboard.example";
const IMPORT_URL = `${DASHBOARD}/api/providers/cookie-import`;

const pairing = (overrides = {}) => ({
  token: TOKEN,
  expiresAt: new Date(NOW + 120_000).toISOString(),
  ttlSeconds: 120,
  header: PAIRING_HEADER,
  provider: "grok-web",
  action: "create",
  name: "Synthetic Grok",
  importUrl: IMPORT_URL,
  contract: { origin: "https://grok.com", cookieNames: ["sso"], cookiePrefixes: [] },
  ...overrides,
});
const chatgptPairing = (overrides = {}) => pairing({
  provider: "chatgpt-web",
  contract: { origin: "https://chatgpt.com", cookieNames: ["__Secure-next-auth.session-token"], cookiePrefixes: ["__Secure-next-auth.session-token."] },
  ...overrides,
});
const parsed = (p, now = NOW) => {
  const result = parsePairing(JSON.stringify({ pairing: p }), now);
  expect(result.ok, result.code).toBe(true);
  return result.plan;
};

const cookie = (name, value, extra = {}) => ({ name, value, domain: "grok.com", secure: true, ...extra });

/** Fake chrome.* with a call log. */
function makeChrome({ tabUrl = "https://grok.com/", tabId = 7, held = [], request = async () => true, cookies = {}, stores } = {}) {
  const state = { tabUrl, held: new Set(held) };
  const calls = [];
  const rec = (name, arg) => calls.push({ name, arg: structuredClone(arg) });
  const names = (q) => [...(q.permissions ?? []), ...(q.origins ?? [])];
  const chrome = {
    tabs: {
      query: async (q) => { rec("tabs.query", q); return state.tabUrl === null ? [] : [{ id: tabId, url: state.tabUrl }]; },
      get: async (id) => { rec("tabs.get", id); return { id, url: state.tabUrl }; },
    },
    permissions: {
      contains: async (q) => { rec("permissions.contains", q); return names(q).every((n) => state.held.has(n)); },
      request: async (q) => {
        rec("permissions.request", q);
        const ok = await request(q);
        if (ok) names(q).forEach((n) => state.held.add(n));
        return ok;
      },
      remove: async (q) => { rec("permissions.remove", q); names(q).forEach((n) => state.held.delete(n)); return true; },
    },
    cookies: {
      getAllCookieStores: async () => { rec("cookies.getAllCookieStores", {}); return stores ?? [{ id: "other", tabIds: [999] }, { id: "store-1", tabIds: [tabId] }]; },
      get: async (details) => { rec("cookies.get", details); return cookies[details.name] ?? null; },
    },
  };
  return { chrome, calls, state };
}
const callNames = (calls) => calls.map((c) => c.name);
const response = (status, body = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const makeFetch = (status = 201, body = { ok: true, action: "create", connection: { id: "conn-1", provider: "grok-web", name: "Synthetic Grok" } }) =>
  vi.fn(async () => response(status, body));

const leaks = (value, secrets) => {
  const text = JSON.stringify(value);
  for (const secret of secrets) expect(text).not.toContain(secret);
};

async function capture({ p = pairing(), chromeOpts = {}, fetchImpl = makeFetch(), signal, now = () => NOW, confirmed } = {}) {
  const harness = makeChrome(chromeOpts);
  const plan = parsed(p);
  plan.tabId = 7;
  await preflightPermissions(harness.chrome, plan);
  harness.calls.length = 0;
  const result = await runCapture({ chrome: harness.chrome, fetch: fetchImpl, plan, confirmed: confirmed ?? confirmationFor(plan), signal, now });
  return { ...harness, plan, result, fetch: fetchImpl };
}

describe("manifest and sources", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, "manifest.json"), "utf8"));

  it("is MV3 with no permanent host access, no background and no storage", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(["activeTab"]);
    // `scripting` only reads TinyCMS's localStorage item; it is requested for that provider alone.
    expect(manifest.optional_permissions).toEqual(["cookies", "scripting"]);
    for (const key of ["host_permissions", "background", "content_scripts", "externally_connectable", "web_accessible_resources", "commands", "omnibox"]) {
      expect(manifest, key).not.toHaveProperty(key);
    }
    expect(manifest.action.default_popup).toBe("popup.html");
  });

  it("lists each supported provider origin as optional, plus only dashboard-capable patterns", () => {
    for (const def of Object.values(PROVIDERS)) expect(manifest.optional_host_permissions).toContain(`${def.origin}/*`);
    expect(new Set(manifest.optional_host_permissions)).toEqual(new Set([
      ...Object.values(PROVIDERS).map((d) => `${d.origin}/*`),
      "https://*/*", "http://localhost/*", "http://127.0.0.1/*", "http://[::1]/*",
    ]));
  });

  it("matches the dashboard contract derived from the registry", () => {
    for (const [id, def] of Object.entries(PROVIDERS)) {
      const contract = getCookieImportContract(id);
      expect(contract, id).not.toBeNull();
      expect({ origin: def.origin, names: [...def.cookieNames], prefixes: [...def.cookiePrefixes] }, id)
        .toEqual({ origin: contract.origin, names: [...contract.cookieNames], prefixes: [...contract.cookiePrefixes] });
    }
  });

  it("contains no telemetry, persistence, logging or dynamic code", () => {
    const sources = PACKAGE_FILES.filter((f) => f.endsWith(".js") || f.endsWith(".html")).map((f) => [f, fs.readFileSync(path.join(EXTENSION_DIR, f), "utf8")]);
    const forbidden = [/console\./, /localStorage/, /sessionStorage/, /indexedDB/, /chrome\.storage/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /\beval\(/, /new Function/, /innerHTML/, /document\.cookie/, /https?:\/\/(?!\*)[\w.-]+\.\w+/];
    // TinyCMS (#2034 batch C): the one injected reader may touch page storage, and only to read. It is
    // checked on its own and cut out of capture.js. The plan and request fields that carry item names
    // (`localStorageKeys`, `localStorageCount`, the `localStorage` body field) are data, not storage
    // access, so only those names are blanked; any member access on the storage object still fails below.
    const reader = /export function readLocalStorageItems\(keys\) \{[\s\S]*?\n\}\n/;
    const readerSource = fs.readFileSync(path.join(EXTENSION_DIR, "capture.js"), "utf8").match(reader)?.[0] ?? "";
    expect(readerSource.match(/localStorage\.\w+/g)).toEqual(["localStorage.getItem"]);
    for (const entry of sources) {
      entry[1] = entry[1].replace(reader, "").replace(/\blocalStorage(?:Keys|Count)\b/g, "storageField").replace(/\blocalStorage\b(?!\s*[.[(])/g, "storageField");
    }
    for (const [file, text] of sources) {
      const code = file.endsWith(".js") ? text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "") : text;
      for (const pattern of forbidden) {
        if (pattern.source.startsWith("https?")) continue; // hosts live in providers.js only; checked below
        expect(code, `${file} ${pattern}`).not.toMatch(pattern);
      }
    }
    const capture = fs.readFileSync(path.join(EXTENSION_DIR, "capture.js"), "utf8");
    expect(capture.match(/\bfetch\(/g)).toHaveLength(1);
    expect(capture).not.toMatch(/cookies\.getAll\(/);
    expect(capture).not.toMatch(/cookies\.set|cookies\.remove/);
  });
});

describe("pairing validation", () => {
  it("accepts the dashboard response wrapper and the bare object", () => {
    expect(parsePairing(JSON.stringify({ pairing: pairing() }), NOW).ok).toBe(true);
    expect(parsePairing(JSON.stringify(pairing()), NOW).ok).toBe(true);
  });

  it("binds provider, origin and destination into the plan, and never shows the secret", () => {
    const plan = parsed(pairing({ importUrl: `${DASHBOARD}/api/providers/cookie-import` }));
    expect(plan).toMatchObject({ provider: "grok-web", providerOrigin: "https://grok.com", dashboardOrigin: DASHBOARD, importUrl: IMPORT_URL, action: "create", name: "Synthetic Grok" });
    leaks(describePlan(plan), [TOKEN]);
    expect(describePlan(plan).cookieNames).toEqual(["sso"]);
    expect(describePlan(parsed(chatgptPairing())).cookieNames).toEqual(["__Secure-next-auth.session-token", "__Secure-next-auth.session-token.<n>"]);
  });

  it.each([
    ["not JSON", "nope", "invalid_pairing"],
    ["empty", "", "invalid_pairing"],
    ["array", "[]", "invalid_pairing"],
    ["oversized", " ".repeat(5000), "invalid_pairing"],
  ])("rejects %s text", (_label, text, code) => {
    expect(parsePairing(text, NOW).code).toBe(code);
  });

  it.each([
    ["unknown provider", { provider: "bank-web" }, "unsupported_provider"],
    ["inherited provider key", { provider: "constructor" }, "unsupported_provider"],
    ["bad token", { token: "ddpair_short" }, "invalid_pairing"],
    ["wrong header", { header: "authorization" }, "invalid_pairing"],
    ["create without name", { name: " " }, "invalid_pairing"],
    ["create with connectionId", { connectionId: "c1" }, "invalid_pairing"],
    ["update with name", { action: "update", connectionId: "c1" }, "invalid_pairing"],
    ["unknown action", { action: "delete" }, "invalid_pairing"],
    ["contract origin differs", { contract: { origin: "https://evil.example", cookieNames: ["sso"] } }, "origin_mismatch"],
    ["contract names disjoint", { contract: { origin: "https://grok.com", cookieNames: ["cf_clearance"] } }, "invalid_pairing"],
    ["contract missing", { contract: undefined }, "invalid_pairing"],
    ["insecure dashboard", { importUrl: "http://dashboard.example/api/providers/cookie-import" }, "invalid_destination"],
    ["wrong import path", { importUrl: `${DASHBOARD}/api/providers` }, "invalid_destination"],
    ["pairing path", { importUrl: `${DASHBOARD}/api/providers/cookie-import/pairing` }, "invalid_destination"],
    ["query on destination", { importUrl: `${IMPORT_URL}?next=1` }, "invalid_destination"],
    ["credentials in destination", { importUrl: "https://user:pw@dashboard.example/api/providers/cookie-import" }, "invalid_destination"],
    ["non-http destination", { importUrl: "ftp://dashboard.example/api/providers/cookie-import" }, "invalid_destination"],
    ["destination is a provider site", { importUrl: "https://chatgpt.com/api/providers/cookie-import" }, "invalid_destination"],
    ["missing expiry", { expiresAt: undefined }, "invalid_pairing"],
    ["lifetime beyond ten minutes", { expiresAt: new Date(NOW + 3_600_000).toISOString() }, "invalid_pairing"],
    ["already expired", { expiresAt: new Date(NOW - 1).toISOString() }, "pairing_expired"],
  ])("rejects: %s", (_label, overrides, code) => {
    const result = parsePairing(JSON.stringify({ pairing: pairing(overrides) }), NOW);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(code);
  });

  it("allows plain http only to loopback hosts", () => {
    for (const host of ["localhost:20128", "127.0.0.1:20128", "[::1]:20128"]) {
      expect(parsePairing(JSON.stringify(pairing({ importUrl: `http://${host}/api/providers/cookie-import` })), NOW).ok, host).toBe(true);
    }
    expect(parsePairing(JSON.stringify(pairing({ importUrl: "http://localhost.evil.example/api/providers/cookie-import" })), NOW).ok).toBe(false);
  });

  it("lets a pairing narrow but never widen the built-in cookie allowlist", () => {
    const wide = parsed(pairing({ contract: { origin: "https://grok.com", cookieNames: ["sso", "cf_clearance"], cookiePrefixes: ["sso."] } }));
    expect(wide.cookieNames).toEqual(["sso"]);
    expect(wide.cookiePrefixes).toEqual([]);
    const narrow = parsed(chatgptPairing({ contract: { origin: "https://chatgpt.com", cookieNames: ["__Secure-next-auth.session-token"] } }));
    expect(narrow.cookiePrefixes).toEqual([]);
  });
});

describe("tab binding (prepare)", () => {
  it.each([
    ["another site", "https://example.com/"],
    ["a lookalike host", "https://grok.com.evil.example/"],
    ["a subdomain", "https://accounts.grok.com/"],
    ["plain http", "http://grok.com/"],
    ["a non-web url", "chrome://extensions"],
    ["no url visible", undefined],
  ])("refuses %s and touches nothing but the tab query", async (_label, tabUrl) => {
    const harness = makeChrome({ tabUrl: tabUrl ?? "" });
    const result = await prepareCapture({ chrome: harness.chrome, text: JSON.stringify({ pairing: pairing() }), now: NOW });
    expect(result).toMatchObject({ ok: false, code: "wrong_tab", expectedOrigin: "https://grok.com" });
    expect(callNames(harness.calls)).toEqual(["tabs.query"]);
  });

  it("refuses when there is no active tab", async () => {
    const harness = makeChrome({ tabUrl: null });
    expect((await prepareCapture({ chrome: harness.chrome, text: JSON.stringify(pairing()), now: NOW })).code).toBe("wrong_tab");
  });

  it("does not query anything for an invalid or expired pairing", async () => {
    const harness = makeChrome();
    expect((await prepareCapture({ chrome: harness.chrome, text: "nope", now: NOW })).code).toBe("invalid_pairing");
    expect((await prepareCapture({ chrome: harness.chrome, text: JSON.stringify(pairing()), now: NOW + 121_000 })).code).toBe("pairing_expired");
    expect(harness.calls).toEqual([]);
  });

  it("returns a plan carrying the tab id on the supported tab", async () => {
    const harness = makeChrome();
    const result = await prepareCapture({ chrome: harness.chrome, text: JSON.stringify({ pairing: pairing() }), now: NOW });
    expect(result.ok).toBe(true);
    expect(result.plan.tabId).toBe(7);
  });
});

describe("explicit confirmation", () => {
  it.each([
    ["none", () => undefined],
    ["a string", () => "yes"],
    ["an empty object", () => ({})],
    ["a different dashboard", (plan) => ({ ...confirmationFor(plan), dashboardOrigin: "https://other.example" })],
    ["a different provider", (plan) => ({ ...confirmationFor(plan), provider: "chatgpt-web" })],
    ["a different provider origin", (plan) => ({ ...confirmationFor(plan), providerOrigin: "https://chatgpt.com" })],
  ])("refuses %s before any browser call", async (_label, make) => {
    const harness = makeChrome();
    const plan = parsed(pairing());
    plan.tabId = 7;
    const fetchImpl = makeFetch();
    const result = await runCapture({ chrome: harness.chrome, fetch: fetchImpl, plan, confirmed: make(plan), now: () => NOW });
    expect(result).toMatchObject({ ok: false, code: "not_confirmed" });
    expect(harness.calls).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("permissions", () => {
  it("requests cookies plus exactly the provider and dashboard origins, and gives them back", async () => {
    const { calls, result } = await capture({ chromeOpts: { cookies: { sso: cookie("sso", VALUE) } } });
    expect(result.ok).toBe(true);
    const requests = calls.filter((c) => c.name === "permissions.request");
    expect(requests).toHaveLength(1);
    expect(requests[0].arg).toEqual({ permissions: ["cookies"], origins: ["https://grok.com/*", "https://dashboard.example/*"] });
    const removed = calls.filter((c) => c.name === "permissions.remove");
    expect(removed).toHaveLength(1);
    expect(removed[0].arg).toEqual(requests[0].arg);
    expect(callNames(calls).at(-1)).toBe("permissions.remove");
  });

  it("uses a host-wide loopback pattern for a local dashboard and the exact URL for the request", async () => {
    const importUrl = "http://localhost:20128/api/providers/cookie-import";
    const { calls, fetch } = await capture({ p: pairing({ importUrl }), chromeOpts: { cookies: { sso: cookie("sso", VALUE) } } });
    expect(calls.find((c) => c.name === "permissions.request").arg.origins).toEqual(["https://grok.com/*", "http://localhost/*"]);
    expect(fetch.mock.calls[0][0]).toBe(importUrl);
  });

  it("asks only for what is missing and removes only what it was granted", async () => {
    const { calls, result } = await capture({ chromeOpts: { held: ["cookies", "https://grok.com/*"], cookies: { sso: cookie("sso", VALUE) } } });
    expect(result.ok).toBe(true);
    expect(calls.find((c) => c.name === "permissions.request").arg).toEqual({ permissions: [], origins: ["https://dashboard.example/*"] });
    expect(calls.find((c) => c.name === "permissions.remove").arg).toEqual({ permissions: [], origins: ["https://dashboard.example/*"] });
  });

  it("neither requests nor removes anything when everything was already granted", async () => {
    const { calls, result } = await capture({ chromeOpts: { held: ["cookies", "https://grok.com/*", "https://dashboard.example/*"], cookies: { sso: cookie("sso", VALUE) } } });
    expect(result.ok).toBe(true);
    expect(callNames(calls)).not.toContain("permissions.request");
    expect(callNames(calls)).not.toContain("permissions.remove");
  });

  it("stops without reading or sending when the prompt is denied, and does not ask again", async () => {
    const request = vi.fn(async () => false);
    const { calls, result, fetch } = await capture({ chromeOpts: { request, cookies: { sso: cookie("sso", VALUE) } } });
    expect(result).toMatchObject({ ok: false, code: "permission_denied" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(callNames(calls).filter((n) => n.startsWith("cookies."))).toEqual([]);
    expect(callNames(calls)).not.toContain("permissions.remove");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("treats a rejected request (no user gesture) as a denial", async () => {
    const request = vi.fn(async () => { throw new Error("This function must be called during a user gesture"); });
    const { result, fetch } = await capture({ chromeOpts: { request } });
    expect(result.code).toBe("permission_denied");
    expect(request).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("revokes its grants when the tab navigated away during the prompt", async () => {
    const harness = makeChrome({ request: async () => { harness.state.tabUrl = "https://example.com/"; return true; }, cookies: { sso: cookie("sso", VALUE) } });
    const plan = parsed(pairing());
    plan.tabId = 7;
    const fetchImpl = makeFetch();
    await preflightPermissions(harness.chrome, plan);
    const result = await runCapture({ chrome: harness.chrome, fetch: fetchImpl, plan, confirmed: confirmationFor(plan), now: () => NOW });
    expect(result.code).toBe("wrong_tab");
    expect(callNames(harness.calls)).toContain("permissions.remove");
    expect(callNames(harness.calls).filter((n) => n.startsWith("cookies."))).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("credential filtering and session binding", () => {
  it("reads only approved names from the origin, in the tab's own cookie store, and never lists the jar", async () => {
    const jar = { sso: cookie("sso", VALUE), cf_clearance: cookie("cf_clearance", NOISE), "sso-rw": cookie("sso-rw", NOISE) };
    const { calls, fetch } = await capture({ chromeOpts: { cookies: jar } });
    const gets = calls.filter((c) => c.name === "cookies.get").map((c) => c.arg);
    expect(gets).toEqual([{ url: "https://grok.com/", name: "sso", storeId: "store-1" }]);
    expect(callNames(calls)).not.toContain("cookies.getAll");
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.cookies.map((c) => c.name)).toEqual(["sso"]);
    expect(fetch.mock.calls[0][1].body).not.toContain(NOISE);
  });

  it("collects contiguous chunks only, in index order, and stops at the first gap", async () => {
    const d = { domain: ".chatgpt.com" };
    const jar = {
      "__Secure-next-auth.session-token.0": cookie("__Secure-next-auth.session-token.0", CHUNK0, d),
      "__Secure-next-auth.session-token.1": cookie("__Secure-next-auth.session-token.1", CHUNK1, d),
      "__Secure-next-auth.session-token.3": cookie("__Secure-next-auth.session-token.3", NOISE, d),
    };
    const { calls, fetch, result } = await capture({ p: chatgptPairing(), chromeOpts: { tabUrl: "https://chatgpt.com/c/1", cookies: jar } });
    expect(result.ok).toBe(true);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ provider: "chatgpt-web", origin: "https://chatgpt.com" });
    expect(body.cookies.map((c) => c.name)).toEqual(["__Secure-next-auth.session-token.0", "__Secure-next-auth.session-token.1"]);
    expect(body.cookies[0].domain).toBe("chatgpt.com");
    const requested = calls.filter((c) => c.name === "cookies.get").map((c) => c.arg.name);
    expect(requested).toEqual(["__Secure-next-auth.session-token", "__Secure-next-auth.session-token.0", "__Secure-next-auth.session-token.1", "__Secure-next-auth.session-token.2"]);
    expect(fetch.mock.calls[0][1].body).not.toContain(NOISE);
  });

  it("never exceeds the dashboard's cookie ceiling when probing chunks", async () => {
    const jar = new Proxy({}, { get: (_t, name) => cookie(String(name), VALUE, { domain: "chatgpt.com" }) });
    const { fetch } = await capture({ p: chatgptPairing(), chromeOpts: { tabUrl: "https://chatgpt.com/", cookies: jar } });
    expect(JSON.parse(fetch.mock.calls[0][1].body).cookies.length).toBeLessThanOrEqual(MAX_COOKIES);
  });

  it.each([
    ["not secure", cookie("sso", NOISE, { secure: false })],
    ["from another domain", cookie("sso", NOISE, { domain: "evil.example" })],
    ["from a lookalike domain", cookie("sso", NOISE, { domain: "notgrok.com" })],
    ["a bare suffix domain", cookie("sso", NOISE, { domain: "com" })],
    ["empty", cookie("sso", "")],
    ["returned under another name", cookie("other", NOISE)],
  ])("drops a cookie that is %s", async (_label, bad) => {
    const { result, fetch } = await capture({ chromeOpts: { cookies: { sso: bad } } });
    expect(result).toMatchObject({ ok: false, code: "no_cookies" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps only the fields the import contract defines", async () => {
    const { fetch } = await capture({ chromeOpts: { cookies: { sso: cookie("sso", VALUE, { path: "/", httpOnly: true, sameSite: "lax", hostOnly: true, storeId: "store-1", session: false, expirationDate: 1_900_000_000 }) } } });
    expect(JSON.parse(fetch.mock.calls[0][1].body).cookies).toEqual([{ name: "sso", value: VALUE, domain: "grok.com", secure: true, expirationDate: 1_900_000_000 }]);
  });

  it("refuses to guess a session when no cookie store owns the tab", async () => {
    const { result, calls, fetch } = await capture({ chromeOpts: { stores: [{ id: "0", tabIds: [1] }], cookies: { sso: cookie("sso", VALUE) } } });
    expect(result.code).toBe("no_cookie_store");
    expect(callNames(calls)).not.toContain("cookies.get");
    expect(fetch).not.toHaveBeenCalled();
    expect(callNames(calls)).toContain("permissions.remove");
  });

  it("sends nothing when the user is not signed in", async () => {
    const { result, fetch } = await capture({ chromeOpts: { cookies: {} } });
    expect(result.code).toBe("no_cookies");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("destination binding and request shape", () => {
  it("sends exactly one POST to the paired import URL with the pairing header", async () => {
    const { fetch, plan, result } = await capture({ chromeOpts: { cookies: { sso: cookie("sso", VALUE) } } });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(IMPORT_URL);
    expect(init).toMatchObject({ method: "POST", credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
    expect(init.headers).toEqual({ "content-type": "application/json", [PAIRING_HEADER]: TOKEN });
    expect(Object.keys(JSON.parse(init.body)).sort()).toEqual(["cookies", "origin", "provider"]);
    expect(JSON.parse(init.body)).toMatchObject({ provider: "grok-web", origin: "https://grok.com" });
    expect(result).toEqual({ ok: true, action: "create", cookieCount: 1, connection: { id: "conn-1", name: "Synthetic Grok" } });
    expect(plan.token).toBe("");
  });

  it("targets an existing connection on update, and sends no name", async () => {
    const p = pairing({ action: "update", name: undefined, connectionId: "conn-9" });
    const { fetch, result } = await capture({ p, fetchImpl: makeFetch(200, { ok: true, action: "update", connection: { id: "conn-9", provider: "grok-web", name: "Existing" } }), chromeOpts: { cookies: { sso: cookie("sso", VALUE) } } });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.connectionId).toBe("conn-9");
    expect(body).not.toHaveProperty("name");
    expect(result).toMatchObject({ ok: true, action: "update" });
  });

  it("never reuses a pairing after it was sent", async () => {
    const harness = makeChrome({ cookies: { sso: cookie("sso", VALUE) } });
    const plan = parsed(pairing());
    plan.tabId = 7;
    const fetchImpl = makeFetch();
    await preflightPermissions(harness.chrome, plan);
    const args = { chrome: harness.chrome, fetch: fetchImpl, plan, confirmed: confirmationFor(plan), now: () => NOW };
    expect((await runCapture(args)).ok).toBe(true);
    const before = harness.calls.length;
    expect(await runCapture(args)).toMatchObject({ ok: false, code: "already_used" });
    expect(harness.calls).toHaveLength(before);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps the secret and cookies out of every returned value", async () => {
    const { result } = await capture({ chromeOpts: { cookies: { sso: cookie("sso", VALUE) } } });
    leaks(result, [TOKEN, VALUE]);
    for (const message of Object.values(MESSAGES)) leaks(message, [TOKEN, VALUE]);
  });
});

describe("pairing lifecycle", () => {
  it("does nothing when the pairing expired between review and send", async () => {
    const { calls, result, fetch } = await capture({ now: () => NOW + 121_000, chromeOpts: { cookies: { sso: cookie("sso", VALUE) } } });
    expect(result).toMatchObject({ ok: false, code: "pairing_expired" });
    expect(calls).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stops and revokes when the pairing expires during the permission prompt", async () => {
    let clock = NOW;
    const { calls, result, fetch } = await capture({ now: () => clock, chromeOpts: { request: async () => { clock = NOW + 121_000; return true; }, cookies: { sso: cookie("sso", VALUE) } } });
    expect(result.code).toBe("pairing_expired");
    expect(callNames(calls)).toContain("permissions.remove");
    expect(callNames(calls).filter((n) => n.startsWith("cookies."))).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [400, "rejected"], [401, "pairing_rejected"], [403, "forbidden"], [404, "target_missing"],
    [409, "conflict"], [413, "rejected"], [415, "rejected"], [500, "server_error"], [503, "server_error"], [302, "unexpected_status"],
  ])("maps HTTP %i to %s with fixed text, one request and no retry", async (status, code) => {
    const fetchImpl = makeFetch(status, { error: `server says ${VALUE} ${TOKEN}` });
    const { result, calls } = await capture({ fetchImpl, chromeOpts: { cookies: { sso: cookie("sso", VALUE) } } });
    expect(result).toEqual({ ok: false, code, message: MESSAGES[code] });
    leaks(result, [TOKEN, VALUE]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(callNames(calls).filter((n) => n === "permissions.request")).toHaveLength(1);
    expect(callNames(calls).at(-1)).toBe("permissions.remove");
  });

  it("reports a network failure once, wipes the secret and does not retry", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError(`failed to fetch ${VALUE}`); });
    const { result, plan } = await capture({ fetchImpl, chromeOpts: { cookies: { sso: cookie("sso", VALUE) } } });
    expect(result).toEqual({ ok: false, code: "network_error", message: MESSAGES.network_error });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(plan.token).toBe("");
  });

  it("still succeeds when the success body is unreadable", async () => {
    const fetchImpl = vi.fn(async () => ({ status: 201, json: async () => { throw new Error("bad"); } }));
    const { result } = await capture({ fetchImpl, chromeOpts: { cookies: { sso: cookie("sso", VALUE) } } });
    expect(result).toMatchObject({ ok: true, connection: null });
  });
});

describe("cancellation", () => {
  it("does nothing when cancelled before it starts", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const { calls, result, fetch } = await capture({ signal: ctl.signal, chromeOpts: { cookies: { sso: cookie("sso", VALUE) } } });
    expect(result.code).toBe("cancelled");
    expect(calls).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("revokes and reads nothing when cancelled during the permission prompt", async () => {
    const ctl = new AbortController();
    let release;
    const request = () => new Promise((resolve) => { release = resolve; });
    const harness = makeChrome({ request, cookies: { sso: cookie("sso", VALUE) } });
    const plan = parsed(pairing());
    plan.tabId = 7;
    const fetchImpl = makeFetch();
    await preflightPermissions(harness.chrome, plan);
    const run = runCapture({ chrome: harness.chrome, fetch: fetchImpl, plan, confirmed: confirmationFor(plan), signal: ctl.signal, now: () => NOW });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    ctl.abort();
    release(true);
    expect((await run).code).toBe("cancelled");
    expect(callNames(harness.calls)).toContain("permissions.remove");
    expect(callNames(harness.calls).filter((n) => n.startsWith("cookies."))).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(plan.token).toBe(TOKEN);
  });

  it("is cancelled when the denial arrives after the abort", async () => {
    const ctl = new AbortController();
    const request = async () => { ctl.abort(); return false; };
    const { result } = await capture({ signal: ctl.signal, chromeOpts: { request } });
    expect(result.code).toBe("cancelled");
  });

  it("aborts the in-flight request and revokes permissions", async () => {
    const ctl = new AbortController();
    const fetchImpl = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const harness = makeChrome({ cookies: { sso: cookie("sso", VALUE) } });
    const plan = parsed(pairing());
    plan.tabId = 7;
    await preflightPermissions(harness.chrome, plan);
    const run = runCapture({ chrome: harness.chrome, fetch: fetchImpl, plan, confirmed: confirmationFor(plan), signal: ctl.signal, now: () => NOW });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    ctl.abort();
    expect((await run).code).toBe("cancelled");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(callNames(harness.calls).at(-1)).toBe("permissions.remove");
    expect(plan.token).toBe("");
  });
});

describe("popup", () => {
  const html = fs.readFileSync(path.join(EXTENSION_DIR, "popup.html"), "utf8");
  function mount({ tabUrl = "https://grok.com/", chromeOpts = {}, fetchImpl = makeFetch() } = {}) {
    const win = new Window();
    win.document.write(html);
    const harness = makeChrome({ tabUrl, cookies: { sso: cookie("sso", VALUE) }, ...chromeOpts });
    mountPopup(win.document, { chrome: harness.chrome, fetch: fetchImpl, now: () => NOW });
    const $ = (id) => win.document.getElementById(id);
    const check = (on) => { $("confirm").checked = on; $("confirm").dispatchEvent(new win.Event("change")); };
    return { win, $, check, harness, fetchImpl };
  }
  const review = async (ui, text = JSON.stringify({ pairing: pairing() })) => {
    ui.$("pairing").value = text;
    ui.$("review").click();
    await vi.waitFor(() => expect(ui.$("step-review").hidden && !ui.$("status").textContent).toBe(false));
  };

  it("shows provider and dashboard, and keeps Send disabled until confirmed", async () => {
    const ui = mount();
    await review(ui);
    expect(ui.$("step-review").hidden).toBe(false);
    expect(ui.$("out-provider").textContent).toBe("Grok Web");
    expect(ui.$("out-origin").textContent).toBe("https://grok.com");
    expect(ui.$("out-dashboard").textContent).toBe(DASHBOARD);
    expect(ui.$("out-cookies").textContent).toBe("sso");
    expect(ui.$("confirm-text").textContent).toContain(DASHBOARD);
    expect(ui.$("send").disabled).toBe(true);
    expect(ui.$("pairing").value).toBe("");
    expect(ui.win.document.body.textContent).not.toContain(TOKEN);
    expect(callNames(ui.harness.calls)).toEqual(["tabs.query", "permissions.contains", "permissions.contains", "permissions.contains"]);
    ui.check(true);
    expect(ui.$("send").disabled).toBe(false);
    ui.check(false);
    expect(ui.$("send").disabled).toBe(true);
  });

  it("explains a wrong tab and stays on the pairing step", async () => {
    const ui = mount({ tabUrl: "https://example.com/" });
    await review(ui);
    expect(ui.$("status").textContent).toContain("https://grok.com");
    expect(ui.$("status").className).toBe("error");
    expect(ui.$("step-review").hidden).toBe(true);
  });

  it("requests permission during the confirmed click before its gesture expires", async () => {
    let gesture = false;
    const request = vi.fn(async () => gesture);
    const ui = mount({ chromeOpts: { request } });
    await review(ui);
    expect(callNames(ui.harness.calls)).not.toContain("permissions.request");
    expect(callNames(ui.harness.calls).some((name) => name.startsWith("cookies."))).toBe(false);
    expect(ui.fetchImpl).not.toHaveBeenCalled();
    ui.check(true);
    gesture = true;
    ui.$("send").click();
    gesture = false;
    expect(request).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(ui.$("status").textContent).toContain("Created connection"));
  });

  it("sends once after confirmation, reports success without values, and clears itself", async () => {
    const ui = mount();
    await review(ui);
    ui.check(true);
    ui.$("send").click();
    await vi.waitFor(() => expect(ui.$("status").textContent).toContain("Created connection"));
    expect(ui.fetchImpl).toHaveBeenCalledTimes(1);
    expect(ui.$("step-review").hidden).toBe(true);
    expect(ui.$("step-input").hidden).toBe(false);
    expect(ui.win.document.body.textContent).not.toContain(VALUE);
    expect(ui.win.document.body.textContent).not.toContain(TOKEN);
  });

  it("cancel discards the pairing and sends nothing", async () => {
    const ui = mount();
    await review(ui);
    ui.check(true);
    ui.$("cancel").click();
    expect(ui.$("step-review").hidden).toBe(true);
    expect(ui.$("send").disabled).toBe(true);
    expect(ui.$("status").textContent).toContain("Nothing was sent");
    ui.$("send").click();
    await Promise.resolve();
    expect(ui.fetchImpl).not.toHaveBeenCalled();
    expect(callNames(ui.harness.calls)).toEqual(["tabs.query", "permissions.contains", "permissions.contains", "permissions.contains"]);
  });

  it("keeps the review open after a denied permission and does not retry on its own", async () => {
    const request = vi.fn(async () => false);
    const ui = mount({ chromeOpts: { request } });
    await review(ui);
    ui.check(true);
    ui.$("send").click();
    await vi.waitFor(() => expect(ui.$("status").textContent).toBe(MESSAGES.permission_denied));
    expect(request).toHaveBeenCalledTimes(1);
    expect(ui.$("step-review").hidden).toBe(false);
    expect(ui.fetchImpl).not.toHaveBeenCalled();
  });

  it("recovers when cookie permission is revoked after Review", async () => {
    const ui = mount({ chromeOpts: { held: ["cookies", "https://grok.com/*", "https://dashboard.example/*"] } });
    await review(ui);
    ui.harness.state.held.delete("cookies");
    delete ui.harness.chrome.cookies;
    ui.check(true);
    ui.$("send").click();
    await vi.waitFor(() => expect(ui.$("status").textContent).toBe(MESSAGES.permission_denied));
    expect(ui.$("step-review").hidden).toBe(false);
    expect(ui.$("send").disabled).toBe(false);
    expect(callNames(ui.harness.calls).some((name) => name.startsWith("cookies."))).toBe(false);
    expect(ui.fetchImpl).not.toHaveBeenCalled();
    ui.$("cancel").click();
    expect(ui.$("step-input").hidden).toBe(false);
  });

  it.each(["getAllCookieStores", "get"])("handles a rejected %s read without sending", async (method) => {
    const ui = mount();
    await review(ui);
    ui.harness.chrome.cookies[method] = vi.fn(async () => { throw new Error("permission revoked"); });
    ui.check(true);
    ui.$("send").click();
    await vi.waitFor(() => expect(ui.$("status").textContent).toBe(MESSAGES.permission_denied));
    expect(ui.$("step-review").hidden).toBe(false);
    expect(ui.fetchImpl).not.toHaveBeenCalled();
  });

  it("returns to the pairing step after the dashboard rejects the pairing", async () => {
    const ui = mount({ fetchImpl: makeFetch(401, { error: "x" }) });
    await review(ui);
    ui.check(true);
    ui.$("send").click();
    await vi.waitFor(() => expect(ui.$("status").textContent).toBe(MESSAGES.pairing_rejected));
    expect(ui.$("step-input").hidden).toBe(false);
    expect(ui.fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("local distribution", () => {
  function readZip(buffer) {
    const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const count = buffer.readUInt16LE(end + 10);
    let offset = buffer.readUInt32LE(end + 16);
    const entries = [];
    for (let i = 0; i < count; i += 1) {
      expect(buffer.readUInt32LE(offset)).toBe(0x02014b50);
      const method = buffer.readUInt16LE(offset + 10);
      const crc = buffer.readUInt32LE(offset + 16);
      const size = buffer.readUInt32LE(offset + 24);
      const nameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const local = buffer.readUInt32LE(offset + 42);
      const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
      const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      entries.push({ name, method, crc, data: buffer.subarray(dataStart, dataStart + size), time: buffer.readUInt16LE(offset + 12), date: buffer.readUInt16LE(offset + 14) });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  it("builds a byte-identical zip every time, with intact files and fixed timestamps", async () => {
    const first = await buildPackage();
    const second = await buildPackage();
    expect(first.zip.equals(second.zip)).toBe(true);
    expect(first.sha256).toBe(second.sha256);
    expect(first.fileName).toBe("durindoor-cookie-capture-0.1.0.zip");
    const entries = readZip(first.zip);
    expect(entries.map((e) => e.name)).toEqual([...PACKAGE_FILES].sort());
    for (const entry of entries) {
      expect(entry.method).toBe(0);
      expect(crc32(entry.data) >>> 0).toBe(entry.crc);
      expect(entry.data.equals(fs.readFileSync(path.join(EXTENSION_DIR, entry.name)))).toBe(true);
      expect([entry.date, entry.time]).toEqual([(1 << 5) | 1, 0]);
    }
  });

  it("ships every file the manifest, popup and modules reference, and no tests or docs", () => {
    const html = fs.readFileSync(path.join(EXTENSION_DIR, "popup.html"), "utf8");
    const referenced = new Set(["manifest.json", "popup.html"]);
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) referenced.add(m[1]);
    for (const file of PACKAGE_FILES.filter((f) => f.endsWith(".js"))) {
      for (const m of fs.readFileSync(path.join(EXTENSION_DIR, file), "utf8").matchAll(/from "\.\/([^"]+)"/g)) referenced.add(m[1]);
    }
    for (const file of referenced) expect(PACKAGE_FILES, file).toContain(file);
    expect(PACKAGE_FILES.some((f) => /\.test\.|README|dist/.test(f))).toBe(false);
    expect(PACKAGE_FILES.every((f) => fs.existsSync(path.join(EXTENSION_DIR, f)))).toBe(true);
  });

  it("the CLI writes the zip and a matching checksum and verifies reproducibility", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-ext-"));
    try {
      const stdout = execFileSync(process.execPath, [path.join(REPO, "scripts/package-cookie-extension.mjs"), "--out", out, "--check"], { encoding: "utf8" });
      const { fileName, sha256, zip } = await buildPackage();
      expect(stdout).toContain(sha256);
      expect(fs.readFileSync(path.join(out, fileName)).equals(zip)).toBe(true);
      expect(fs.readFileSync(path.join(out, `${fileName}.sha256`), "utf8")).toBe(`${sha256}  ${fileName}\n`);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});

// #2034: Inner.ai Web and Venice Web capture. Each is one exact-origin, one-cookie entry; the
// Inner.ai account email is bound by the dashboard pairing and never read or sent by the extension.
describe("Inner.ai Web and Venice Web capture", () => {
  const INNER = "https://app.innerai.com";
  const CLERK = "https://clerk.venice.ai";
  const innerPairing = (overrides = {}) => pairing({ provider: "inner-ai-web", name: "Synthetic Inner", contract: { origin: INNER, cookieNames: ["token"], cookiePrefixes: [] }, ...overrides });
  const venicePairing = (overrides = {}) => pairing({ provider: "venice-web", name: "Synthetic Venice", contract: { origin: CLERK, cookieNames: ["__client"], cookiePrefixes: [] }, ...overrides });
  const fetchFor = (provider) => makeFetch(201, { ok: true, action: "create", connection: { id: "conn-1", provider, name: "Synthetic" } });

  it("compiles exactly one origin and one cookie for each, and lists only those host permissions", () => {
    expect(PROVIDERS["inner-ai-web"]).toEqual({ label: "Inner.ai Web", origin: INNER, cookieNames: ["token"], cookiePrefixes: [] });
    expect(PROVIDERS["venice-web"]).toEqual({ label: "Venice Web", origin: CLERK, cookieNames: ["__client"], cookiePrefixes: [] });
    const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, "manifest.json"), "utf8"));
    const hosts = manifest.optional_host_permissions.filter((pattern) => /innerai|venice/.test(pattern));
    expect(hosts).toEqual([`${INNER}/*`, `${CLERK}/*`]);
    expect(manifest.optional_host_permissions.filter((pattern) => pattern.includes("*.")).every((pattern) => pattern === "https://*/*")).toBe(true);
  });

  it("refuses wrong-provider, wrong-origin and widened pairings, and ignores an email in the pairing", () => {
    expect(parsePairing(JSON.stringify(innerPairing({ contract: { origin: CLERK, cookieNames: ["token"] } })), NOW).code).toBe("origin_mismatch");
    expect(parsePairing(JSON.stringify(venicePairing({ contract: { origin: "https://venice.ai", cookieNames: ["__client"] } })), NOW).code).toBe("origin_mismatch");
    expect(parsePairing(JSON.stringify(venicePairing({ contract: { origin: CLERK, cookieNames: ["__session"] } })), NOW).code).toBe("invalid_pairing");
    expect(parsePairing(JSON.stringify(innerPairing({ contract: { origin: INNER, cookieNames: ["token"], extensionCapture: false } })), NOW).code).toBe("invalid_pairing");
    const wide = parsed(venicePairing({ contract: { origin: CLERK, cookieNames: ["__client", "__session", "__client_uat"], cookiePrefixes: ["__client."] } }));
    expect(wide).toMatchObject({ cookieNames: ["__client"], cookiePrefixes: [], optionalCookies: [], localStorageKeys: [] });
    const tampered = parsed(innerPairing({ accountEmail: "attacker@example.com", contract: { origin: INNER, cookieNames: ["token"], accountEmail: "attacker@example.com" } }));
    expect(JSON.stringify(tampered)).not.toContain("attacker@example.com");
    expect(JSON.stringify(describePlan(tampered))).not.toContain("attacker@example.com");
  });

  it.each([
    ["venice.ai, where the user signs in", "https://venice.ai/chat"],
    ["the Venice API host", "https://outerface.venice.ai/"],
    ["a lookalike Clerk host", "https://clerk.venice.ai.evil.example/"],
    ["plain http Clerk", "http://clerk.venice.ai/"],
  ])("binds Venice capture to the exact Clerk tab, not %s", async (_label, tabUrl) => {
    const harness = makeChrome({ tabUrl });
    const result = await prepareCapture({ chrome: harness.chrome, text: JSON.stringify({ pairing: venicePairing() }), now: NOW });
    expect(result).toMatchObject({ ok: false, code: "wrong_tab", expectedOrigin: CLERK });
    expect(callNames(harness.calls)).toEqual(["tabs.query"]);
  });

  it.each([
    ["the Inner.ai marketing site", "https://innerai.com/"],
    ["another Inner.ai host", "https://chatapi.innerai.com/"],
  ])("binds Inner.ai capture to the exact app tab, not %s", async (_label, tabUrl) => {
    const harness = makeChrome({ tabUrl });
    const result = await prepareCapture({ chrome: harness.chrome, text: JSON.stringify({ pairing: innerPairing() }), now: NOW });
    expect(result).toMatchObject({ ok: false, code: "wrong_tab", expectedOrigin: INNER });
  });

  it("captures the Clerk __client cookie from the Clerk tab, asks for exactly two origins and gives them back", async () => {
    const harness = makeChrome({ tabUrl: `${CLERK}/v1/client` });
    const prepared = await prepareCapture({ chrome: harness.chrome, text: JSON.stringify({ pairing: venicePairing() }), now: NOW });
    expect(prepared.ok).toBe(true);
    harness.calls.length = 0;
    const jar = { __client: cookie("__client", VALUE, { domain: ".clerk.venice.ai" }), __session: cookie("__session", NOISE, { domain: "venice.ai" }) };
    Object.assign(harness.chrome.cookies, { get: async (details) => { harness.calls.push({ name: "cookies.get", arg: details }); return jar[details.name] ?? null; } });
    const fetchImpl = fetchFor("venice-web");
    const result = await runCapture({ chrome: harness.chrome, fetch: fetchImpl, plan: prepared.plan, confirmed: confirmationFor(prepared.plan), now: () => NOW });
    expect(result).toMatchObject({ ok: true, cookieCount: 1 });
    expect(harness.calls.filter((c) => c.name === "cookies.get").map((c) => c.arg)).toEqual([{ url: `${CLERK}/`, name: "__client", storeId: "store-1" }]);
    const request = harness.calls.find((c) => c.name === "permissions.request").arg;
    expect(request).toEqual({ permissions: ["cookies"], origins: [`${CLERK}/*`, `${DASHBOARD}/*`] });
    expect(harness.calls.find((c) => c.name === "permissions.remove").arg).toEqual(request);
    expect([...harness.state.held]).toEqual([]);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toEqual({ provider: "venice-web", origin: CLERK, cookies: [{ name: "__client", value: VALUE, domain: "clerk.venice.ai", secure: true }] });
    leaks(result, [VALUE, TOKEN]);
  });

  it.each([
    ["the Venice API host", "outerface.venice.ai"],
    ["another site", "evil.example"],
    ["a bare suffix", "ai"],
  ])("drops a Venice __client cookie scoped to %s", async (_label, domain) => {
    const { result, fetch } = await capture({ p: venicePairing(), chromeOpts: { tabUrl: `${CLERK}/`, cookies: { __client: cookie("__client", NOISE, { domain }) } } });
    expect(result).toMatchObject({ ok: false, code: "no_cookies" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("captures the .innerai.com token cookie and never sends an account email", async () => {
    const jar = { token: cookie("token", VALUE, { domain: ".innerai.com" }), refresh_token: cookie("refresh_token", NOISE, { domain: ".innerai.com" }) };
    const fetchImpl = fetchFor("inner-ai-web");
    const { calls, result, state } = await capture({ p: innerPairing({ accountEmail: "attacker@example.com" }), chromeOpts: { tabUrl: `${INNER}/chat`, cookies: jar }, fetchImpl });
    expect(result).toMatchObject({ ok: true, cookieCount: 1 });
    expect(calls.filter((c) => c.name === "cookies.get").map((c) => c.arg.name)).toEqual(["token"]);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toEqual({ provider: "inner-ai-web", origin: INNER, cookies: [{ name: "token", value: VALUE, domain: "innerai.com", secure: true }] });
    expect(fetchImpl.mock.calls[0][1].body).not.toContain("attacker@example.com");
    expect(calls.find((c) => c.name === "permissions.request").arg).toEqual({ permissions: ["cookies"], origins: [`${INNER}/*`, `${DASHBOARD}/*`] });
    expect(callNames(calls).at(-1)).toBe("permissions.remove");
    expect([...state.held]).toEqual([]);
  });

  it("gives back its grants when the Inner.ai tab navigates away before the read", async () => {
    const harness = makeChrome({ tabUrl: `${INNER}/`, request: async () => { harness.state.tabUrl = "https://innerai.com/"; return true; }, cookies: { token: cookie("token", VALUE, { domain: ".innerai.com" }) } });
    const plan = parsed(innerPairing());
    plan.tabId = 7;
    const fetchImpl = fetchFor("inner-ai-web");
    await preflightPermissions(harness.chrome, plan);
    const result = await runCapture({ chrome: harness.chrome, fetch: fetchImpl, plan, confirmed: confirmationFor(plan), now: () => NOW });
    expect(result.code).toBe("wrong_tab");
    expect(callNames(harness.calls).filter((n) => n.startsWith("cookies."))).toEqual([]);
    expect(callNames(harness.calls)).toContain("permissions.remove");
    expect([...harness.state.held]).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
