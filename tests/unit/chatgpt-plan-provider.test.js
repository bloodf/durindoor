import { createPrivateKey, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../fixtures/chatgpt-plan-synthetic-jwk.json";

const issuer = "https://auth.openai.com";
const tokenUrl = issuer + "/api/accounts/oauth/token";
const revokeUrl = issuer + "/api/accounts/oauth/revoke";
const jwksUrl = issuer + "/.well-known/jwks.json";
const redirectUri = "http://127.0.0.1:1455/auth/callback";
const scopes = "openid offline_access resource.invoke chatgpt.tokens.use.direct";
const now = 1_800_000_000_000;
const key = createPrivateKey({ key: fixture, format: "jwk" });
const jwks = { keys: [{ kty: "RSA", n: fixture.n, e: fixture.e, kid: "fixture", alg: "RS256" }] };

let root;
let driver;
let repo;
let createAccounts;
let crypto;
let exchanges;
let fetchAdapter;

function tokens(label) {
  return { access_token: `access-${label}`, refresh_token: `refresh-${label}`, token_type: "bearer", expires_in: 3600 };
}

function signedIdentity(url, selection, overrides = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = [
    encode({ alg: "RS256", kid: "fixture" }),
    encode({
      iss: issuer, sub: selection.subject, aud: selection.clientId, nonce: url.searchParams.get("nonce"),
      iat: now / 1000, exp: now / 1000 + 3600, email: "shared@example.test", email_verified: true,
      ...overrides,
    }),
  ].join(".");
  return `${input}.${sign("sha256", Buffer.from(input), key).toString("base64url")}`;
}

function service(clock = () => now) {
  return createAccounts({ fetchAdapter, clock });
}

function queueExchange(start, clientId, subject, response, claims) {
  const url = new URL(start.authorizationUrl);
  const idToken = signedIdentity(url, { clientId, subject }, claims);
  const callback = `${redirectUri}?${new URLSearchParams({
    state: url.searchParams.get("state"), code: "synthetic-code", client_id: clientId,
  })}`;
  exchanges.push(
    { url: tokenUrl, form: { grant_type: "authorization_code", client_id: clientId },
      response: { ...tokens(clientId), scope: scopes, id_token: idToken, ...response } },
    { url: jwksUrl, response: jwks },
  );
  return { callback, idToken };
}

async function enroll(accounts, clientId = "oaiapp_fixture", response) {
  const start = await accounts.beginAuthorization({ redirectUri });
  const { callback, idToken } = queueExchange(start, clientId, "subject", response);
  return { selection: await accounts.finishAuthorization(start.handle, callback), idToken };
}

function holdRequest(entry) {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  exchanges.push({ ...entry, response: () => {
    entered.resolve();
    return release.promise;
  } });
  return { entered: entered.promise, release: release.resolve };
}

async function reopen() {
  driver.setActiveAdapter(await driver.openSqliteAdapter(join(process.env.DATA_DIR, "db", "data.sqlite")));
  crypto.__resetColumnCryptoForTests();
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "chatgpt-plan-provider-"));
  vi.stubEnv("DATA_DIR", join(root, "data"));
  vi.stubEnv("HOME", join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const name of ["DURINDOOR_PG_URL", "DURINDOOR_DATABASE_ENV_SOURCE_JSON", "DURINDOOR_DATABASE_ENV_FILE"]) {
    vi.stubEnv(name, undefined);
  }
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected global fetch"); }));
  delete globalThis._dbAdapter;
  vi.resetModules();
  driver = await import("../../src/lib/db/driver.js");
  repo = await import("../../src/lib/db/repos/connectionsRepo.js");
  crypto = await import("../../src/lib/crypto/columnCrypto.js");
  ({ createChatGptPlanAccounts: createAccounts } = await import("../../src/lib/oauth/chatgptPlanAccounts.js"));
  exchanges = [];
  fetchAdapter = vi.fn(async (url, init) => {
    const entry = exchanges.shift();
    expect(url).toBe(entry?.url);
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    if (entry.form) expect(Object.fromEntries(init.body)).toMatchObject(entry.form);
    const response = typeof entry.response === "function" ? await entry.response() : entry.response;
    return response instanceof Response ? response : Response.json(response);
  });
});

afterEach(async () => {
  try {
    expect(exchanges).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally {
    await globalThis._dbAdapter?.instance?.close?.();
    delete globalThis._dbAdapter;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});

describe("private ChatGPT plan accounts", () => {
  it("keeps same-email registrations separate and reopens encrypted credentials", async () => {
    const accounts = service();
    const first = await enroll(accounts);
    const second = await enroll(accounts, "oaiapp_second");
    expect(first.selection.id).not.toBe(second.selection.id);
    const db = await driver.getAdapter();
    const stored = db.get("SELECT value FROM kv WHERE scope = ? AND key = ?", [
      "privateChatGptPlanAccounts", first.selection.id,
    ]).value;
    const extra = JSON.parse(JSON.parse(stored).data);
    for (const field of ["accessToken", "refreshToken", "idToken"]) expect(crypto.isEncryptedBlob(extra[field])).toBe(true);
    for (const value of ["access-oaiapp_fixture", "refresh-oaiapp_fixture", first.idToken]) expect(stored).not.toContain(value);
    expect(extra.providerSpecificData).toEqual({
      ...Object.fromEntries(["issuer", "subject", "clientId"].map((field) => [field, first.selection[field]])),
      hostId: accounts.hostId, scopes: scopes.split(" "), tokenType: "Bearer", savedAt: now,
      expiresAt: now + 3_600_000, earliestRefreshAt: null,
    });
    expect(await repo.getProviderConnections()).toEqual([]);
    expect(await repo.getProviderConnectionById(first.selection.id)).toBeNull();
    await reopen();
    const restarted = service();
    expect(restarted.hostId).toBe(accounts.hostId);
    expect(await restarted.readAccount(first.selection)).toMatchObject({
      accessToken: "access-oaiapp_fixture", refreshToken: "refresh-oaiapp_fixture",
      idToken: first.idToken, planEnabled: true, email: "shared@example.test",
    });
    expect(await restarted.readAccount(second.selection)).toMatchObject({ refreshToken: "refresh-oaiapp_second" });
  });

  it("requires every selected identity field and consumes each authorization handle once", async () => {
    const accounts = service();
    const { selection, idToken } = await enroll(accounts);
    for (const field of ["id", "issuer", "subject", "clientId"]) {
      await expect(accounts.refresh({ ...selection, [field]: "wrong" })).rejects.toMatchObject({ code: "account_mismatch" });
    }
    const first = await accounts.beginAuthorization({ redirectUri, selection });
    const second = await accounts.beginAuthorization({ redirectUri, selection });
    const firstUrl = new URL(first.authorizationUrl);
    const secondUrl = new URL(second.authorizationUrl);
    expect(firstUrl.searchParams.get("id_token_hint")).toBe(idToken);
    expect(firstUrl.searchParams.get("client_id")).toBe(selection.clientId);
    for (const field of ["state", "nonce", "code_challenge"]) {
      expect(firstUrl.searchParams.get(field)).not.toBe(secondUrl.searchParams.get(field));
    }
    await expect(accounts.finishAuthorization(first.handle, redirectUri)).rejects.toMatchObject({ code: "invalid_callback" });
    await expect(accounts.finishAuthorization(first.handle, redirectUri)).rejects.toMatchObject({ code: "unknown_attempt" });
    const { callback } = queueExchange(second, selection.clientId, "different-subject");
    await expect(accounts.finishAuthorization(second.handle, callback)).rejects.toMatchObject({ code: "invalid_identity" });
    expect((await accounts.readAccount(selection)).idToken).toBe(idToken);
  });

  it("durably claims rotation before dispatch and saves the entire refreshed grant", async () => {
    let time = now;
    const accounts = service(() => time);
    const { selection, idToken } = await enroll(accounts, undefined, { earliest_refresh_at: now / 1000 + 5 });
    await expect(accounts.refresh(selection)).rejects.toMatchObject({ code: "refresh_too_early" });
    time += 5000;
    const held = holdRequest({
      url: tokenUrl, form: { grant_type: "refresh_token", client_id: selection.clientId, refresh_token: "refresh-oaiapp_fixture" },
    });
    const refreshing = accounts.refresh(selection);
    await held.entered;
    await reopen();
    const contender = service(() => time);
    await expect(contender.refresh(selection)).rejects.toMatchObject({ code: "session_claimed" });
    await expect(contender.signOut(selection)).rejects.toMatchObject({ code: "session_claimed" });
    held.release({ ...tokens("rotated"), scope: "openid", earliest_refresh_at: time / 1000 + 20 });
    await refreshing;
    await reopen();
    expect(await service().readAccount(selection)).toMatchObject({
      accessToken: "access-rotated", refreshToken: "refresh-rotated", idToken,
      scopes: ["openid"], planEnabled: false, savedAt: time, expiresAt: time + 3_600_000,
      earliestRefreshAt: time + 20_000, operation: null,
    });
    expect(fetchAdapter).toHaveBeenCalledTimes(3);
  });

  it("preserves the prior grant and blocks replay after an ambiguous refresh", async () => {
    const accounts = service();
    const { selection } = await enroll(accounts);
    exchanges.push({ url: tokenUrl, response: () => { throw new Error("synthetic disconnect"); } });
    await expect(accounts.refresh(selection)).rejects.toMatchObject({ code: "transport_failed" });
    await reopen();
    const restarted = service();
    expect(await restarted.readAccount(selection)).toMatchObject({ refreshToken: "refresh-oaiapp_fixture", operation: "refresh" });
    await expect(restarted.refresh(selection)).rejects.toMatchObject({ code: "session_claimed" });
    expect(await restarted.signOut(selection, { localOnly: true })).toEqual({ revocation: "unconfirmed" });
    expect((await restarted.readAccount(selection)).refreshToken).toBeUndefined();
  });

  it.each(["refresh", "revoke"])("fences a stale %s completion after verified reauthorization", async (operation) => {
    const accounts = service();
    const { selection } = await enroll(accounts);
    const held = holdRequest({ url: operation === "refresh" ? tokenUrl : revokeUrl });
    const pending = operation === "refresh" ? accounts.refresh(selection) : accounts.signOut(selection);
    const outcome = expect(pending).rejects.toMatchObject({ code: "stale_session" });
    await held.entered;
    const start = await accounts.beginAuthorization({ redirectUri, selection });
    const { callback } = queueExchange(start, selection.clientId, selection.subject, tokens("new-session"));
    await accounts.finishAuthorization(start.handle, callback);
    held.release(operation === "refresh" ? tokens("stale") : new Response(""));
    await outcome;
    expect(await accounts.readAccount(selection)).toMatchObject({ refreshToken: "refresh-new-session", operation: null });
  });

  it("fences a pending sign-in after local sign-out", async () => {
    const accounts = service();
    const { selection } = await enroll(accounts);
    const start = await accounts.beginAuthorization({ redirectUri, selection });
    const { callback } = queueExchange(start, selection.clientId, selection.subject, tokens("late"));
    expect(await accounts.signOut(selection, { localOnly: true })).toEqual({ revocation: "unconfirmed" });
    await expect(accounts.finishAuthorization(start.handle, callback)).rejects.toMatchObject({ code: "stale_session" });
    expect((await accounts.readAccount(selection)).accessToken).toBeUndefined();
  });

  it("allows a failed remote revocation to be retried and retains the registration after sign-out", async () => {
    const accounts = service();
    const { selection } = await enroll(accounts);
    const form = { token: "refresh-oaiapp_fixture", client_id: selection.clientId, token_type_hint: "refresh_token" };
    exchanges.push(
      { url: revokeUrl, form, response: Response.json({}, { status: 503 }) },
      { url: revokeUrl, form, response: new Response("") },
    );
    await expect(accounts.signOut(selection)).rejects.toMatchObject({ code: "request_failed", status: 503 });
    expect(await accounts.signOut(selection)).toEqual({ revocation: "confirmed" });
    const record = await accounts.readAccount(selection);
    for (const field of ["accessToken", "refreshToken", "idToken"]) expect(record[field]).toBeUndefined();
    expect(record).toMatchObject({ ...selection, scopes: [], planEnabled: false });
    const { authorizationUrl } = await accounts.beginAuthorization({ redirectUri, selection });
    expect(new URL(authorizationUrl).searchParams.get("client_id")).toBe(selection.clientId);
    expect(new URL(authorizationUrl).searchParams.has("id_token_hint")).toBe(false);
  });

  it("moves a selected session to a VM with its own persisted host identity", async () => {
    const source = service();
    const { selection } = await enroll(source);
    const transfer = await source.detachForVm(selection);
    await expect(source.refresh(selection)).rejects.toMatchObject({ code: "no_refresh_token" });
    vi.stubEnv("DATA_DIR", join(root, "vm-data"));
    crypto.__resetColumnCryptoForTests();
    const vm = service();
    expect(vm.hostId).not.toBe(source.hostId);
    await expect(vm.bindFromOwnerTransfer({ ...selection, subject: "other" }, transfer))
      .rejects.toMatchObject({ code: "account_mismatch" });
    await vm.bindFromOwnerTransfer(selection, transfer);
    await expect(vm.bindFromOwnerTransfer(selection, transfer)).rejects.toMatchObject({ code: "stale_session" });
    expect(await vm.readAccount(selection)).toMatchObject({ hostId: vm.hostId, refreshToken: "refresh-oaiapp_fixture" });
    const { authorizationUrl } = await service().beginAuthorization({ redirectUri, selection });
    expect(new URL(authorizationUrl).searchParams.get("ext_agent_host_id")).toBe(vm.hostId);
  });
});
