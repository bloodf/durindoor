// Veo AI Free saved-session cookie name (#2034). WordPress core names the signed-in cookie
// `wordpress_logged_in_` . COOKIEHASH with COOKIEHASH = md5(siteurl option)
// (wp-includes/default-constants.php, wp_cookie_constants()). The siteurl option is site
// configuration the public origin does not reveal, so the contract approves the family by its
// fixed grammar (prefix + 32 lowercase hex) instead of one guessed digest. The MV3 extension never
// lists a cookie store, so it reads the md5 of each siteurl that can serve the origin by exact
// name; any other digest goes through the dashboard Cookie/cURL/HAR import. Closed mocks only:
// no network, no browser, synthetic values.
import crypto from "node:crypto";
import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildImportedCookieHeader, describeCookieImportContract, getCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";
import { buildImportCandidates, parseCookieHeaderValue, parseCurlCommand, parseHarDocument } from "../../src/shared/utils/cookieImportParser.js";
import {
  contractUsesCookies, displayCookieNames, hashedCookiePrefixOf, isApprovedCookieName, resolveCookieImportContract,
} from "../../src/shared/utils/cookieImportContract.js";
import { PROVIDERS as EXTENSION_PROVIDERS } from "../../extensions/provider-cookie-capture/providers.js";
import { parsePairing, preflightPermissions, runCapture, confirmationFor, describePlan } from "../../extensions/provider-cookie-capture/capture.js";
import veoRegistry from "../../open-sse/providers/registry/veoaifree-web.js";

const ORIGIN = "https://veoaifree.com";
const DASHBOARD = "https://dashboard.example";
const PREFIX = "wordpress_logged_in_";
const GUESSED = `${PREFIX}04e805bfa8c7064a04c2e480966a748b`; // md5("https://veoaifree.com"), unverified
const HTTP_SITEURL = `${PREFIX}77a56418528ca2de949e000403796177`; // md5("http://veoaifree.com")
const OTHER = `${PREFIX}0123456789abcdef0123456789abcdef`;
const VALUE = "synthetic-user%7C1900000000%7Ctoken%7Chmac";
const VALUE_2 = "synthetic-second-session";
const NOISE = "synthetic-unapproved-value";
const TOKEN = `ddpair_${"B".repeat(43)}`;
const NOW = Date.UTC(2026, 10, 27, 12, 0, 0);

const contract = () => getCookieImportContract("veoaifree-web");
const cookie = (name, extra = {}) => ({ name, value: VALUE, domain: "veoaifree.com", secure: true, ...extra });

describe("contract: WordPress logged-in family, not a guessed digest", () => {
  it("names the family on the exact origin and no fixed cookie name", () => {
    const c = contract();
    expect(c).toMatchObject({ origin: ORIGIN, host: "veoaifree.com", extensionCapture: true });
    expect([...c.cookieNames]).toEqual([]);
    expect([...c.hashedCookiePrefixes]).toEqual([PREFIX]);
    expect(contractUsesCookies(c)).toBe(true);
    expect(displayCookieNames(c)).toEqual([`${PREFIX}<md5>`]);
    expect(describeCookieImportContract(c)).toEqual({ origin: ORIGIN, cookieNames: [], cookiePrefixes: [], hashedCookiePrefixes: [PREFIX] });
    expect(veoRegistry.cookieImport.cookieNames).toEqual([]);
    expect(JSON.stringify(veoRegistry.cookieImport)).not.toContain("04e805bf");
  });

  it("approves every md5 member and nothing else", () => {
    const c = contract();
    for (const name of [GUESSED, HTTP_SITEURL, OTHER]) {
      expect(isApprovedCookieName(c, name), name).toBe(true);
      expect(hashedCookiePrefixOf(c, name)).toBe(PREFIX);
    }
    for (const name of [
      PREFIX, "wordpress_logged_in", `${PREFIX}deadbeef`, `${PREFIX}x`, `${PREFIX}${"a".repeat(31)}`, `${PREFIX}${"a".repeat(33)}`,
      `${PREFIX}${"A".repeat(32)}`, `${PREFIX}${"g".repeat(32)}`, `${PREFIX}${"a".repeat(32)}.0`,
      `wordpress_logged_inX${"a".repeat(32)}`, `wordpress_sec_${"a".repeat(32)}`, `wordpress_${"a".repeat(32)}`,
      "wordpress_test_cookie", `wp-settings-${"1"}`, "cf_clearance", `x${GUESSED}`,
    ]) expect(isApprovedCookieName(c, name), name).toBe(false);
  });

  it("only takes a closed prefix grammar from a profile, never a pattern", () => {
    const base = { origin: ORIGIN, cookieNames: [] };
    expect(resolveCookieImportContract({ ...base, hashedCookiePrefixes: [PREFIX] })).not.toBeNull();
    for (const hashedCookiePrefixes of [[], "wordpress_logged_in_", ["wordpress_logged_in"], [".*"], ["^wordpress_logged_in_[0-9a-f]+$"], [PREFIX, PREFIX], ["a_", "b_", "c_"], [`${"a".repeat(64)}_`]]) {
      expect(resolveCookieImportContract({ ...base, hashedCookiePrefixes }), JSON.stringify(hashedCookiePrefixes)).toBeNull();
    }
    // Other providers are untouched: no family, fixed names only.
    const grok = getCookieImportContract("grok-web");
    expect(grok.hashedCookiePrefixes).toBeUndefined();
    expect(isApprovedCookieName(grok, OTHER)).toBe(false);
  });
});

describe("server import: exactly one member, exact host, redacted errors", () => {
  it("stores whichever digest the site uses, first, with noise refused", () => {
    for (const name of [GUESSED, HTTP_SITEURL, OTHER]) {
      expect(buildImportedCookieHeader(contract(), [cookie(name)])).toEqual({ ok: true, header: `${name}=${VALUE}` });
    }
  });

  it("refuses an absent, ambiguous, foreign, insecure or expired member without echoing it", () => {
    for (const cookies of [
      [cookie(GUESSED), cookie(OTHER, { value: VALUE_2 })],
      [cookie(OTHER, { domain: "veoaifree.com.evil.example" })],
      [cookie(OTHER, { domain: "evil.example" })],
      [cookie(OTHER, { secure: false })],
      [cookie(OTHER, { expirationDate: 1 })],
      [cookie(OTHER), { name: "wordpress_sec_0123456789abcdef0123456789abcdef", value: NOISE }],
      [{ name: "wordpress_test_cookie", value: NOISE }],
      [],
    ]) {
      const built = buildImportedCookieHeader(contract(), cookies, NOW);
      expect(built.ok, JSON.stringify(cookies)).toBe(false);
      expect(JSON.stringify(built)).not.toContain(VALUE);
      expect(JSON.stringify(built)).not.toContain(VALUE_2);
      expect(JSON.stringify(built)).not.toContain("0123456789abcdef");
    }
  });
});

describe("dashboard parsers: Cookie header, cURL and HAR agree", () => {
  it("keeps the member under any digest from each input shape and drops the rest", () => {
    const header = buildImportCandidates({ kind: "header", parsed: parseCookieHeaderValue(`wordpress_test_cookie=WP; ${OTHER}=${VALUE}; cf_clearance=${NOISE}; wordpress_sec_${"a".repeat(32)}=${NOISE}`) }, contract());
    expect(header).toMatchObject({ ok: true, candidates: [{ origin: ORIGIN, cookies: [{ name: OTHER, value: VALUE }] }] });
    expect(header.candidates[0].dropped).toEqual(["wordpress_test_cookie", "cf_clearance", `wordpress_sec_${"a".repeat(32)}`]);

    const curl = buildImportCandidates({ kind: "curl", parsed: parseCurlCommand(`curl 'https://veoaifree.com/wp-admin/admin-ajax.php' -H 'cookie: ${HTTP_SITEURL}=${VALUE}; other=${NOISE}'`) }, contract());
    expect(curl).toMatchObject({ ok: true, candidates: [{ cookies: [{ name: HTTP_SITEURL, value: VALUE }] }] });
    expect(buildImportCandidates({ kind: "curl", parsed: parseCurlCommand(`curl 'https://www.veoaifree.com/' -H 'cookie: ${OTHER}=${VALUE}'`) }, contract()).ok).toBe(false);

    const har = buildImportCandidates({ kind: "har", parsed: parseHarDocument(JSON.stringify({ log: { entries: [
      { request: { url: "https://evil.example/", headers: [{ name: "cookie", value: `${OTHER}=${VALUE_2}` }] } },
      { request: { url: `${ORIGIN}/`, cookies: [{ name: OTHER, value: VALUE }, { name: "cf_clearance", value: NOISE }], headers: [] } },
    ] } })) }, contract());
    expect(har).toMatchObject({ ok: true, candidates: [{ origin: ORIGIN, cookies: [{ name: OTHER, value: VALUE }] }] });
    expect(JSON.stringify(har)).not.toContain(VALUE_2);
    expect(JSON.stringify(har)).not.toContain(NOISE);
  });

  it("refuses an input without a member or with two digests", () => {
    for (const text of [`${PREFIX}deadbeef=${VALUE}`, `${PREFIX}=${VALUE}`, `wordpress_test_cookie=WP`, `${GUESSED}=${VALUE}; ${OTHER}=${VALUE_2}`]) {
      const result = buildImportCandidates({ kind: "header", parsed: parseCookieHeaderValue(text) }, contract());
      expect(result.ok, text).toBe(false);
      expect(result.error).not.toContain(VALUE);
    }
  });
});

describe("MV3 capture: exact-name reads of bounded candidates, never a store listing", () => {
  const SITEURLS = ["https://veoaifree.com", "http://veoaifree.com", "https://www.veoaifree.com", "http://www.veoaifree.com"];
  const CANDIDATES = SITEURLS.map((url) => `${PREFIX}${crypto.createHash("md5").update(url).digest("hex")}`);
  const pairing = (overrides = {}) => ({
    token: TOKEN, expiresAt: new Date(NOW + 120_000).toISOString(), ttlSeconds: 120, header: "x-durindoor-pairing-token",
    provider: "veoaifree-web", action: "create", name: "Veo session",
    importUrl: `${DASHBOARD}/api/providers/cookie-import`,
    contract: describeCookieImportContract(contract()),
    ...overrides,
  });
  function harness(jar) {
    const calls = [];
    const held = new Set();
    const names = (q) => [...(q.permissions ?? []), ...(q.origins ?? [])];
    const chrome = {
      tabs: { query: async () => [{ id: 7, url: `${ORIGIN}/` }], get: async (id) => ({ id, url: `${ORIGIN}/` }) },
      permissions: {
        contains: async (q) => names(q).every((n) => held.has(n)),
        request: async (q) => { calls.push(["permissions.request", q]); names(q).forEach((n) => held.add(n)); return true; },
        remove: async (q) => { names(q).forEach((n) => held.delete(n)); return true; },
      },
      cookies: {
        getAllCookieStores: async () => [{ id: "store-9", tabIds: [7] }],
        get: async (details) => { calls.push(["cookies.get", details]); return jar[details.name] ?? null; },
        getAll: async (details) => { calls.push(["cookies.getAll", details]); return []; },
      },
    };
    return { chrome, calls };
  }
  async function capture(jar) {
    const parsed = parsePairing(JSON.stringify({ pairing: pairing() }), NOW);
    expect(parsed.ok, parsed.code).toBe(true);
    const { chrome, calls } = harness(jar);
    parsed.plan.tabId = 7;
    await preflightPermissions(chrome, parsed.plan);
    const fetchImpl = vi.fn(async () => ({ status: 201, ok: true, json: async () => ({ connection: { id: "c1", name: "Veo session" } }) }));
    const result = await runCapture({ chrome, fetch: fetchImpl, plan: parsed.plan, confirmed: confirmationFor(parsed.plan), now: () => NOW });
    return { result, calls, fetchImpl, plan: parsed.plan };
  }
  const member = (name, extra = {}) => ({ [name]: { name, value: VALUE, domain: "veoaifree.com", secure: true, ...extra } });

  it("ships the family plus the md5 of each siteurl that can serve the origin, host access optional and exact", () => {
    const def = EXTENSION_PROVIDERS["veoaifree-web"];
    expect(def).toEqual({ label: "Veo AI Free Web", origin: ORIGIN, cookieNames: [], cookiePrefixes: [], hashedCookiePrefixes: [PREFIX], hashedCookieCandidates: CANDIDATES });
    expect(def.hashedCookiePrefixes).toEqual([...contract().hashedCookiePrefixes]);
    for (const name of def.hashedCookieCandidates) expect(isApprovedCookieName(contract(), name), name).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(new URL("../../extensions/provider-cookie-capture/manifest.json", import.meta.url), "utf8"));
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.optional_host_permissions.filter((p) => p.includes("veoaifree"))).toEqual([`${ORIGIN}/*`]);
    expect(fs.readFileSync(new URL("../../extensions/provider-cookie-capture/capture.js", import.meta.url), "utf8")).not.toMatch(/cookies\.getAll\(/);
  });

  it("posts the one secure member found under any candidate, read by exact name only", async () => {
    const jar = {
      ...member(CANDIDATES[1], { domain: ".veoaifree.com", expirationDate: 1_900_000_000 }),
      wordpress_test_cookie: { name: "wordpress_test_cookie", value: NOISE, domain: "veoaifree.com", secure: true },
      cf_clearance: { name: "cf_clearance", value: NOISE, domain: "veoaifree.com", secure: true },
    };
    const { result, calls, fetchImpl, plan } = await capture(jar);
    expect(result).toMatchObject({ ok: true, cookieCount: 1 });
    expect(describePlan(plan).cookieNames).toEqual([`${PREFIX}<md5>`]);
    expect(calls.filter(([name]) => name.startsWith("cookies."))).toEqual(CANDIDATES.map((name) => ["cookies.get", { url: `${ORIGIN}/`, name, storeId: "store-9" }]));
    expect(calls.find(([name]) => name === "permissions.request")[1]).toEqual({ permissions: ["cookies"], origins: [`${ORIGIN}/*`, `${DASHBOARD}/*`] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${DASHBOARD}/api/providers/cookie-import`);
    expect(JSON.parse(init.body)).toEqual({ provider: "veoaifree-web", origin: ORIGIN, cookies: [{ name: CANDIDATES[1], value: VALUE, domain: "veoaifree.com", secure: true, expirationDate: 1_900_000_000 }] });
    expect(init.body).not.toContain(NOISE);
    expect(JSON.stringify(result)).not.toContain(VALUE);
  });

  it("sends nothing for an absent, insecure, foreign or ambiguous member", async () => {
    const cases = [
      [{}, "no_cookies"],
      [member(OTHER), "no_cookies"], // not a candidate: never read, use the dashboard import
      [member(CANDIDATES[0], { secure: false }), "no_cookies"],
      [member(CANDIDATES[0], { domain: "evil.example" }), "no_cookies"],
      [member(CANDIDATES[0], { value: "" }), "no_cookies"],
      [{ ...member(CANDIDATES[0]), [CANDIDATES[2]]: { name: CANDIDATES[2], value: VALUE_2, domain: "veoaifree.com", secure: true } }, "ambiguous_cookies"],
    ];
    for (const [jar, code] of cases) {
      const { result, fetchImpl, calls } = await capture(jar);
      expect(result.code, JSON.stringify(Object.keys(jar))).toBe(code);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(calls.some(([name]) => name === "cookies.getAll")).toBe(false);
      expect(JSON.stringify(result)).not.toContain(VALUE);
      expect(JSON.stringify(result)).not.toContain(VALUE_2);
    }
  });

  it("lets a pairing narrow the family away only by failing, never widen it", () => {
    const described = describeCookieImportContract(contract());
    expect(parsePairing(JSON.stringify({ pairing: pairing({ contract: { ...described, hashedCookiePrefixes: undefined } }) }), NOW)).toMatchObject({ ok: false, code: "invalid_pairing" });
    const widened = parsePairing(JSON.stringify({ pairing: pairing({ contract: { ...described, cookieNames: ["cf_clearance"], hashedCookiePrefixes: [PREFIX, "wordpress_sec_", "wp_"], hashedCookieCandidates: [OTHER] } }) }), NOW);
    expect(widened.ok).toBe(true);
    expect(widened.plan.cookieNames).toEqual([]);
    expect(widened.plan.hashedCookiePrefixes).toEqual([PREFIX]);
    expect(widened.plan.hashedCookieCandidates).toEqual(CANDIDATES);
    expect(parsePairing(JSON.stringify({ pairing: pairing({ contract: { ...described, origin: "https://www.veoaifree.com" } }) }), NOW)).toMatchObject({ ok: false, code: "origin_mismatch" });
  });

  it("reads no candidate for a fixed-name provider", () => {
    const grok = parsePairing(JSON.stringify({ pairing: pairing({ provider: "grok-web", contract: describeCookieImportContract(getCookieImportContract("grok-web")) }) }), NOW);
    expect(grok.ok, grok.code).toBe(true);
    expect(grok.plan.hashedCookiePrefixes).toEqual([]);
    expect(grok.plan.hashedCookieCandidates).toEqual([]);
  });
});
