import { createHash, createPrivateKey, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import fixture from "../fixtures/chatgpt-plan-synthetic-jwk.json";
import {
  createChatGptPlanProtocol,
  parseChatGptPlanCallback,
  startChatGptPlanAuthorization,
} from "../../src/lib/oauth/chatgptPlanProtocol.js";

const issuer = "https://auth.openai.com";
const tokenUrl = issuer + "/api/accounts/oauth/token";
const jwksUrl = issuer + "/.well-known/jwks.json";
const revokeUrl = issuer + "/api/accounts/oauth/revoke";
const resource = "https://api.openai.com/v1";
const clientId = "oaiapp_fixture";
const subject = "fixture-subject";
const redirectUri = "http://127.0.0.1:1455/auth/callback";
const hostId = "urn:uuid:00000000-0000-4000-8000-000000000001";
const now = 1_800_000_000_000;
const scopes = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const registration = { issuer, clientId, subject };
const privateKey = createPrivateKey({ key: fixture, format: "jwk" });
const jwks = { keys: [{ kty: "RSA", n: fixture.n, e: fixture.e, kid: "fixture", alg: "RS256" }] };

function start(options = {}) {
  return startChatGptPlanAuthorization({ redirectUri, hostId, ...options }, now);
}

function callback(attempt, overrides = {}) {
  const query = new URLSearchParams({ code: "fixture-code", state: attempt.state, client_id: clientId, ...overrides });
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) query.delete(name);
  }
  return `${attempt.redirectUri}?${query}`;
}

function signedIdentity(attempt, claims = {}, header = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = [
    encode({ alg: "RS256", kid: "fixture", ...header }),
    encode({
      iss: issuer, sub: subject, aud: clientId, nonce: attempt.nonce,
      iat: now / 1000, exp: now / 1000 + 3600, email: "fixture@example.test",
      email_verified: true, ...claims,
    }),
  ].join(".");
  return `${input}.${sign("sha256", Buffer.from(input), privateKey).toString("base64url")}`;
}

function tokens(attempt, overrides = {}) {
  return {
    access_token: "fixture-access", refresh_token: "fixture-refresh", token_type: "bearer",
    expires_in: 3600, scope: scopes, id_token: signedIdentity(attempt), ...overrides,
  };
}

function closedMock(entries = []) {
  const fetchAdapter = vi.fn(async (url, init) => {
    const entry = entries.shift();
    if (!entry || entry[0] !== url) throw new Error("Unexpected mock request");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    return entry[1] instanceof Response ? entry[1] : Response.json(entry[1]);
  });
  return { fetchAdapter, ...createChatGptPlanProtocol({ fetchAdapter, clock: () => now }) };
}

describe("private ChatGPT plan OAuth", () => {
  it("builds fresh initial authorization and exchanges with the issued client", async () => {
    const { attempt, authorizationUrl } = start();
    const url = new URL(authorizationUrl);
    expect(url.origin + url.pathname).toBe(issuer + "/api/accounts/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "dynamic_agent_client", agent_name_hint: "DurinDoor", ext_agent_host_id: hostId,
      redirect_uri: redirectUri, response_type: "code", resource, scope: scopes,
      state: attempt.state, nonce: attempt.nonce, code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(attempt.codeVerifier).digest("base64url"),
    });
    expect(new Set([attempt.nonce, attempt.state, attempt.codeVerifier]).size).toBe(3);
    const next = start().attempt;
    for (const field of ["state", "nonce", "codeVerifier"]) expect(next[field]).not.toBe(attempt[field]);
    const data = tokens(attempt, { earliest_refresh_at: now / 1000 + 100 });
    const protocol = closedMock([[tokenUrl, data], [jwksUrl, jwks]]);
    const record = await protocol.exchangeCode(attempt, callback(attempt, { scope: "openid" }));
    expect(record).toEqual({
      ...registration, hostId, email: "fixture@example.test", idToken: data.id_token,
      accessToken: "fixture-access", refreshToken: "fixture-refresh", tokenType: "Bearer",
      scopes: scopes.split(" "), planEnabled: true, savedAt: now,
      expiresAt: now + 3600_000, earliestRefreshAt: now + 100_000,
    });
    expect(Object.fromEntries(protocol.fetchAdapter.mock.calls[0][1].body)).toEqual({
      grant_type: "authorization_code", client_id: clientId, code: "fixture-code",
      redirect_uri: redirectUri, code_verifier: attempt.codeVerifier, resource,
    });
  });

  it.each([
    "http://localhost:1455/auth/callback", "https://127.0.0.1:1455/auth/callback",
    "http://127.1:1455/auth/callback", "http://127.0.0.1:65536/auth/callback",
    "http://127.0.0.1:0/auth/callback", "http://127.0.0.1:01455/auth/callback",
    "http://127.0.0.1:1455/callback", "http://127.0.0.1:1455/x/../auth/callback",
    redirectUri + "?x=1", redirectUri + "#x", redirectUri + "\n",
  ])("rejects noncanonical redirect URI %j", (uri) => {
    expect(() => start({ redirectUri: uri })).toThrowError(expect.objectContaining({ code: "invalid_authorization" }));
  });

  it("checks callback address, state, expiry, and registration before sending anything", async () => {
    const { attempt } = start();
    const valid = callback(attempt);
    const protocol = closedMock();
    for (const bad of [
      valid.replace(":1455", ":1456"), valid.replace("/auth/callback", "/auth/%63allback"),
      valid + "#frag", valid + "&state=" + attempt.state, valid + "&code=other",
      `${redirectUri}??state=${attempt.state}&code=fixture-code&client_id=${clientId}`,
      valid.replace("fixture-code", "%XX"),
      callback(attempt, { state: "wrong", error: "access_denied" }),
      callback(attempt, { client_id: undefined }), callback(attempt, { client_id: "dynamic_agent_client" }),
      callback(attempt, { code: "" }), callback(attempt, { iss: "https://other.example.test" }),
    ]) {
      await expect(protocol.exchangeCode(attempt, bad)).rejects.toMatchObject({ code: "invalid_callback" });
    }
    expect(() => parseChatGptPlanCallback(attempt, valid, attempt.expiresAt)).toThrow("invalid_callback");
    await expect(protocol.exchangeCode(attempt, callback(attempt, {
      error: "access_denied", error_description: "private input",
    }))).rejects.toMatchObject({ code: "access_denied", message: "ChatGPT plan OAuth: access_denied" });
    expect(protocol.fetchAdapter).not.toHaveBeenCalled();
  });

  it("reauthorizes the saved registration on another port and requires the saved subject", async () => {
    const { attempt, authorizationUrl } = start({
      redirectUri: "http://127.0.0.1:54321/auth/callback",
      registration: { ...registration, idToken: "fixture-hint", email: "fixture@example.test" },
    });
    const query = new URL(authorizationUrl).searchParams;
    expect(query.get("client_id")).toBe(clientId);
    expect(query.get("id_token_hint")).toBe("fixture-hint");
    expect(query.get("login_hint")).toBe("fixture@example.test");
    expect(query.has("agent_name_hint")).toBe(false);
    const protocol = closedMock([[tokenUrl, tokens(attempt)], [jwksUrl, jwks]]);
    await expect(protocol.exchangeCode(attempt, callback(attempt, { client_id: undefined })))
      .resolves.toMatchObject(registration);
    await expect(protocol.exchangeCode(attempt, callback(attempt, { client_id: "oaiapp_other" })))
      .rejects.toMatchObject({ code: "invalid_callback" });
    expect(protocol.fetchAdapter).toHaveBeenCalledTimes(2);
    const other = closedMock([[tokenUrl, tokens(attempt, { id_token: signedIdentity(attempt, { sub: "other" }) })], [jwksUrl, jwks]]);
    await expect(other.exchangeCode(attempt, callback(attempt))).rejects.toMatchObject({ code: "invalid_identity" });
  });

  it.each([
    ["issuer", { iss: "https://other.example.test" }],
    ["audience", { aud: "oaiapp_other" }],
    ["authorized party", { aud: [clientId, "oaiapp_other"] }],
    ["expiry", { exp: now / 1000 }],
    ["missing expiry", { exp: undefined }],
    ["nonce", { nonce: "other" }],
    ["subject", { sub: " " }],
    ["missing issued-at", { iat: undefined }],
  ])("rejects invalid signed %s", async (_, claims) => {
    const { attempt } = start();
    const protocol = closedMock([[tokenUrl, tokens(attempt, { id_token: signedIdentity(attempt, claims) })], [jwksUrl, jwks]]);
    await expect(protocol.exchangeCode(attempt, callback(attempt))).rejects.toMatchObject({ code: "invalid_identity" });
  });

  it("rejects tampered signatures, unexpected algorithms, and unknown JWKS keys", async () => {
    const { attempt } = start();
    const idToken = signedIdentity(attempt);
    const [header, payload, signature] = idToken.split(".");
    for (const token of [
      `${header}.${payload}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`,
      signedIdentity(attempt, {}, { alg: "HS256" }),
      signedIdentity(attempt, {}, { kid: "missing", jku: "https://other.example.test/jwks" }),
    ]) {
      const protocol = closedMock([[tokenUrl, tokens(attempt, { id_token: token })], [jwksUrl, jwks]]);
      await expect(protocol.exchangeCode(attempt, callback(attempt))).rejects.toMatchObject({ code: "invalid_identity" });
      expect(protocol.fetchAdapter.mock.calls.map(([url]) => url)).toEqual([tokenUrl, jwksUrl]);
    }
  });

  it("keeps verified sign-in when plan permission is missing from the token grant", async () => {
    const { attempt } = start();
    const data = tokens(attempt, {
      scope: "openid email", refresh_token: undefined,
      id_token: signedIdentity(attempt, { email_verified: false }),
    });
    const protocol = closedMock([[tokenUrl, data], [jwksUrl, jwks]]);
    const record = await protocol.exchangeCode(attempt, callback(attempt, { scope: scopes }));
    expect(record).toMatchObject({ subject, planEnabled: false, scopes: ["openid", "email"] });
    expect(record.email).toBeUndefined();
    expect(record.refreshToken).toBeUndefined();
  });

  it("rotates the saved session, retains omitted scopes and verifies explicit scope loss", async () => {
    const record = { ...registration, refreshToken: "fixture-refresh", scopes: scopes.split(" "), idToken: "verified-hint" };
    const rotated = {
      access_token: "next-access", refresh_token: "next-refresh", token_type: "Bearer",
      expires_in: 3600, earliest_refresh_at: new Date(now + 120_000).toISOString(),
      id_token: "unverified-refresh-hint",
    };
    const protocol = closedMock([
      [tokenUrl, rotated], [tokenUrl, { ...rotated, refresh_token: "last-refresh", scope: "openid" }],
      [revokeUrl, new Response(null, { status: 200 })],
    ]);
    const refreshed = await protocol.refresh(record);
    expect(refreshed).toMatchObject({
      ...registration, accessToken: "next-access", refreshToken: "next-refresh",
      planEnabled: true, expiresAt: now + 3600_000, earliestRefreshAt: now + 120_000,
      scopes: record.scopes, idToken: record.idToken,
    });
    expect(Object.fromEntries(protocol.fetchAdapter.mock.calls[0][1].body)).toEqual({
      grant_type: "refresh_token", client_id: clientId, refresh_token: record.refreshToken, resource,
    });
    const reduced = await protocol.refresh(refreshed);
    expect(reduced).toMatchObject({ planEnabled: false, scopes: ["openid"], refreshToken: "last-refresh" });
    await expect(protocol.revoke(reduced)).resolves.toBeUndefined();
    expect(Object.fromEntries(protocol.fetchAdapter.mock.calls[2][1].body)).toEqual({
      client_id: clientId, token_type_hint: "refresh_token", token: "last-refresh",
    });
  });

  it.each([
    { refresh_token: undefined }, { access_token: "" }, { scope: undefined },
    { token_type: "other" }, { expires_in: "3600" }, { earliest_refresh_at: "invalid" },
    { error: "access_denied" }, { scope: ["openid"] },
  ])("rejects malformed token fields %j", async (overrides) => {
    const { attempt } = start();
    const protocol = closedMock([[tokenUrl, tokens(attempt, overrides)]]);
    await expect(protocol.exchangeCode(attempt, callback(attempt))).rejects.toMatchObject({ code: "invalid_response" });
    expect(protocol.fetchAdapter).toHaveBeenCalledTimes(1);
  });

  it("rejects unrotated refresh results and unissued saved clients", async () => {
    const record = { ...registration, refreshToken: "fixture-refresh", scopes: scopes.split(" ") };
    const protocol = closedMock([[tokenUrl, tokens(start().attempt)]]);
    await expect(protocol.refresh(record)).rejects.toMatchObject({ code: "invalid_response" });
    await expect(protocol.refresh({ ...record, clientId: "dynamic_agent_client" }))
      .rejects.toMatchObject({ code: "invalid_registration" });
    expect(protocol.fetchAdapter).toHaveBeenCalledTimes(1);
  });

  it("redacts known and unknown provider errors, oversized bodies, and transport errors", async () => {
    const { attempt } = start();
    const secret = "fixture-secret";
    const protocol = closedMock([
      [tokenUrl, Response.json({ error: { code: "invalid_grant", message: secret } }, { status: 400 })],
      [tokenUrl, Response.json({ error: secret }, { status: 400 })],
      [tokenUrl, new Response(secret.repeat(2000), { status: 503 })],
      [tokenUrl, new Response("{")],
      [tokenUrl, new Response(secret.repeat(10_000))],
    ]);
    for (const [code, status] of [
      ["invalid_grant", 400], ["request_failed", 400], ["request_failed", 503],
      ["invalid_response", undefined], ["invalid_response", undefined], ["transport_failed", undefined],
    ]) {
      await expect(protocol.exchangeCode(attempt, callback(attempt))).rejects.toMatchObject({
        code, status, message: `ChatGPT plan OAuth: ${code}${status ? ` (HTTP ${status})` : ""}`,
      });
    }
    const revoke = closedMock([
      [revokeUrl, Response.json({ error: secret }, { status: 503 })],
      [revokeUrl, Response.json({ error: secret })],
    ]);
    const record = { ...registration, refreshToken: secret };
    await expect(revoke.revoke(record))
      .rejects.toMatchObject({ message: "ChatGPT plan OAuth: request_failed (HTTP 503)" });
    await expect(revoke.revoke(record)).rejects.toMatchObject({ code: "invalid_response" });
  });
});
