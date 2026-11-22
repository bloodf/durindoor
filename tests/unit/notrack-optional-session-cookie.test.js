/**
 * NoTrack Web: the optional `nt_session` cookie is kept by the extension capture and the dashboard
 * import when present, and never required. Closed mocks and synthetic cookie values only.
 */
import { describe, expect, it, vi } from "vitest";

import { PROVIDERS as EXTENSION_PROVIDERS, PAIRING_HEADER } from "../../extensions/provider-cookie-capture/providers.js";
import { parsePairing, preflightPermissions, runCapture, confirmationFor, describePlan } from "../../extensions/provider-cookie-capture/capture.js";
import { getCookieImportContract, describeCookieImportContract, buildImportedCookieHeader } from "../../src/lib/providers/cookieImport/contract.js";
import {
  parseCookieHeaderValue,
  parseCurlCommand,
  parseHarDocument,
  buildImportCandidates,
} from "../../src/shared/utils/cookieImportParser.js";
import { resolveCookieImportContract } from "../../src/shared/utils/cookieImportContract.js";
import { NotrackWebExecutor } from "../../open-sse/executors/notrack-web.js";

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const ORIGIN = "https://notrack.ai";
const TOKEN = `ddpair_${"B".repeat(43)}`;
const REQUIRED = "uid=uid-synthetic; si_usr_id=user-synthetic; si_ses_id=session-synthetic";
const WITH_OPTIONAL = `${REQUIRED}; nt_session=nt-synthetic`;
const NOISE = "cf_clearance=noise-synthetic";

const contract = getCookieImportContract("notrack-web");

describe("NoTrack Web optional nt_session: contract", () => {
  it("lists nt_session as optional and keeps the required names unchanged", () => {
    expect(contract.cookieNames).toEqual(["uid", "si_usr_id", "si_ses_id"]);
    expect(contract.optionalCookies).toEqual(["nt_session"]);
    expect(describeCookieImportContract(contract).cookieNames).toEqual(["uid", "si_usr_id", "si_ses_id"]);
    expect(EXTENSION_PROVIDERS["notrack-web"].optionalCookies).toEqual(["nt_session"]);
  });

  it("rejects an optional name that repeats a required name or is not a cookie token", () => {
    const base = { origin: ORIGIN, cookieNames: ["uid"], cookiePrefixes: [] };
    expect(resolveCookieImportContract({ ...base, optionalCookies: ["uid"] })).toBeNull();
    expect(resolveCookieImportContract({ ...base, optionalCookies: ["bad name"] })).toBeNull();
    expect(resolveCookieImportContract({ ...base, optionalCookies: "nt_session" })).toBeNull();
    expect(resolveCookieImportContract({ ...base, optionalCookies: ["a", "a"] })).toBeNull();
    expect(resolveCookieImportContract({ ...base, optionalCookies: ["nt_session"] }).optionalCookies).toEqual(["nt_session"]);
  });
});

describe("NoTrack Web optional nt_session: extension capture", () => {
  const pairing = (contractOverrides = {}) => ({
    token: TOKEN,
    expiresAt: new Date(NOW + 120_000).toISOString(),
    ttlSeconds: 120,
    header: PAIRING_HEADER,
    provider: "notrack-web",
    action: "create",
    name: "Synthetic NoTrack",
    importUrl: "https://dashboard.example/api/providers/cookie-import",
    contract: { ...describeCookieImportContract(contract), optionalCookies: ["nt_session"], ...contractOverrides },
  });
  const jarCookie = (name, value) => ({ name, value, domain: "notrack.ai", secure: true });

  async function run({ jar, p = pairing() }) {
    const state = { held: new Set() };
    const names = (q) => [...(q.permissions ?? []), ...(q.origins ?? [])];
    const gets = [];
    const chrome = {
      tabs: { query: async () => [{ id: 7, url: `${ORIGIN}/` }], get: async (id) => ({ id, url: `${ORIGIN}/` }) },
      permissions: {
        contains: async (q) => names(q).every((n) => state.held.has(n)),
        request: async (q) => { names(q).forEach((n) => state.held.add(n)); return true; },
        remove: async () => true,
      },
      cookies: {
        getAllCookieStores: async () => [{ id: "store-1", tabIds: [7] }],
        get: async (details) => { gets.push(details.name); return jar[details.name] ?? null; },
      },
    };
    const parsed = parsePairing(JSON.stringify({ pairing: p }), NOW);
    expect(parsed.ok, parsed.code).toBe(true);
    const plan = parsed.plan;
    plan.tabId = 7;
    await preflightPermissions(chrome, plan);
    const fetchImpl = vi.fn(async () => ({ status: 201, ok: true, json: async () => ({ connection: { id: "conn-1", name: "Synthetic NoTrack" } }) }));
    const result = await runCapture({ chrome, fetch: fetchImpl, plan, confirmed: confirmationFor(plan), now: () => NOW });
    return { plan, result, gets, body: fetchImpl.mock.calls[0] ? JSON.parse(fetchImpl.mock.calls[0][1].body) : null };
  }

  const required = { uid: jarCookie("uid", "uid-synthetic"), si_usr_id: jarCookie("si_usr_id", "user-synthetic"), si_ses_id: jarCookie("si_ses_id", "session-synthetic") };

  it("sends nt_session after the required cookies when the browser has it", async () => {
    const { result, body, gets, plan } = await run({ jar: { ...required, nt_session: jarCookie("nt_session", "nt-synthetic") } });
    expect(result.ok).toBe(true);
    expect(gets).toEqual(["uid", "si_usr_id", "si_ses_id", "nt_session"]);
    expect(body.cookies.map((c) => c.name)).toEqual(["uid", "si_usr_id", "si_ses_id", "nt_session"]);
    expect(result.cookieCount).toBe(4);
    expect(describePlan(plan).optionalCookies).toEqual(["nt_session"]);
  });

  it("still succeeds without nt_session", async () => {
    const { result, body } = await run({ jar: required });
    expect(result.ok).toBe(true);
    expect(body.cookies.map((c) => c.name)).toEqual(["uid", "si_usr_id", "si_ses_id"]);
  });

  it("the server still refuses a capture that carries nt_session without the required cookies", () => {
    const server = buildImportedCookieHeader(contract, [{ name: "nt_session", value: "nt-synthetic", secure: true, domain: "notrack.ai" }], NOW);
    expect(server.ok).toBe(false);
  });

  it("does not read nt_session when an older pairing does not name it", async () => {
    const { result, gets } = await run({ jar: { ...required, nt_session: jarCookie("nt_session", "nt-synthetic") }, p: pairing({ optionalCookies: undefined }) });
    expect(result.ok).toBe(true);
    expect(gets).toEqual(["uid", "si_usr_id", "si_ses_id"]);
  });

  it("never reads an unapproved cookie", async () => {
    const { gets } = await run({ jar: { ...required, cf_clearance: jarCookie("cf_clearance", "noise-synthetic") } });
    expect(gets).not.toContain("cf_clearance");
  });
});

describe("NoTrack Web optional nt_session: dashboard import", () => {
  const cookieNames = (candidate) => candidate.cookies.map((c) => c.name);
  const store = (candidate) => buildImportedCookieHeader(contract, candidate.cookies.map((c) => ({ ...c, secure: true, domain: "notrack.ai" })), NOW);

  const curl = (cookie) => `curl 'https://notrack.ai/api/dispatch' -H 'content-type: application/json' -H 'cookie: ${cookie}' --data-raw '{}'`;
  const har = (cookie) => JSON.stringify({ log: { entries: [{ request: { url: "https://notrack.ai/api/dispatch", headers: [{ name: "Cookie", value: cookie }], cookies: [] } }] } });

  const shapes = {
    header: (cookie) => ({ kind: "header", parsed: parseCookieHeaderValue(`Cookie: ${cookie}`) }),
    curl: (cookie) => ({ kind: "curl", parsed: parseCurlCommand(curl(cookie)) }),
    har: (cookie) => ({ kind: "har", parsed: parseHarDocument(har(cookie)) }),
  };

  it.each(Object.keys(shapes))("%s with nt_session keeps it in the stored header", (kind) => {
    const input = shapes[kind](`${NOISE}; ${WITH_OPTIONAL}`);
    expect(input.parsed.ok).toBe(true);
    const built = buildImportCandidates(input, contract);
    expect(built.ok).toBe(true);
    const [candidate] = built.candidates;
    expect(cookieNames(candidate)).toEqual(["uid", "si_usr_id", "si_ses_id", "nt_session"]);
    expect(candidate.dropped).toEqual(["cf_clearance"]);
    const stored = store(candidate);
    expect(stored.ok).toBe(true);
    expect(stored.header).toBe(WITH_OPTIONAL);
  });

  it.each(Object.keys(shapes))("%s without nt_session still imports", (kind) => {
    const input = shapes[kind](`${NOISE}; ${REQUIRED}`);
    const built = buildImportCandidates(input, contract);
    expect(built.ok).toBe(true);
    const [candidate] = built.candidates;
    expect(cookieNames(candidate)).toEqual(["uid", "si_usr_id", "si_ses_id"]);
    const stored = store(candidate);
    expect(stored.ok).toBe(true);
    expect(stored.header).toBe(REQUIRED);
  });

  it("a Cookie header with only nt_session and no required cookie is refused", () => {
    const built = buildImportCandidates(shapes.header("nt_session=nt-synthetic"), contract);
    expect(built.ok).toBe(false);
    expect(built.error).toContain("uid");
  });

  it("the server composes the optional cookie after the required ones regardless of input order", () => {
    const cookies = ["nt_session", "si_ses_id", "uid", "si_usr_id"].map((name) => ({ name, value: `${name}-synthetic`, secure: true, domain: "notrack.ai" }));
    expect(buildImportedCookieHeader(contract, cookies, NOW)).toEqual({
      ok: true,
      header: "uid=uid-synthetic; si_usr_id=si_usr_id-synthetic; si_ses_id=si_ses_id-synthetic; nt_session=nt_session-synthetic",
    });
  });
});

describe("NoTrack Web optional nt_session: executor", () => {
  async function dispatchCookie(stored) {
    const fetcher = vi.fn(async () => new Response("data: {\"type\":\"message\",\"content\":\"ok\"}\n\n", { headers: { "content-type": "text/event-stream" } }));
    const executor = new NotrackWebExecutor(fetcher);
    const { response } = await executor.execute({ body: { messages: [{ role: "user", content: "hi" }] }, credentials: { apiKey: stored }, model: "notrack-c" });
    expect(response.status).toBe(200);
    return fetcher.mock.calls[0][1].headers.cookie;
  }

  it("forwards a stored header that carries nt_session", async () => {
    expect(await dispatchCookie(WITH_OPTIONAL)).toBe(WITH_OPTIONAL);
  });

  it("forwards a stored header without nt_session", async () => {
    expect(await dispatchCookie(REQUIRED)).toBe(REQUIRED);
  });
});
