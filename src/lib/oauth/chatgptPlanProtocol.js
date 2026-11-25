import { createLocalJWKSet, jwtVerify } from "jose";
import { isFunction, isNumber, isRecord, isString } from "../../shared/utils/typeChecks.js";
import { generatePKCE, generateState } from "./utils/pkce.js";

const ISSUER = "https://auth.openai.com";
const AUTHORIZE_URL = `${ISSUER}/api/accounts/authorize`;
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const REVOCATION_URL = `${ISSUER}/api/accounts/oauth/revoke`;
const RESOURCE = "https://api.openai.com/v1";
const PLAN_SCOPE = "chatgpt.tokens.use.direct";
const SCOPES = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;
const ERROR_CODES = new Set([
  "access_denied", "invalid_grant", "invalid_client", "invalid_scope",
  "invalid_refresh_token", "token_expired", "refresh_token_expired",
  "refresh_token_invalidated", "refresh_token_reused",
]);

class ChatGptPlanOAuthError extends Error {
  constructor(code, status) {
    super(`ChatGPT plan OAuth: ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "ChatGptPlanOAuthError";
    this.code = code;
    this.status = status;
  }
}

function nonempty(value) {
  return isString(value) && value.trim().length > 0;
}

function issuedClient(value) {
  return isString(value) && /^oaiapp_[A-Za-z0-9_-]{1,256}$/.test(value);
}

export function startChatGptPlanAuthorization({ redirectUri, hostId, registration }, now = Date.now()) {
  const port = isString(redirectUri) &&
    /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/auth\/callback$/.exec(redirectUri)?.[1];
  if (!port || Number(port) > 65535 || !nonempty(hostId)) {
    throw new ChatGptPlanOAuthError("invalid_authorization");
  }
  if (registration && (!issuedClient(registration.clientId) ||
      registration.issuer !== ISSUER || !nonempty(registration.subject))) {
    throw new ChatGptPlanOAuthError("invalid_registration");
  }

  const { state, codeVerifier, codeChallenge } = generatePKCE();
  const attempt = Object.freeze({
    state, nonce: generateState(), codeVerifier, redirectUri, hostId,
    clientId: registration?.clientId,
    subject: registration?.subject,
    expiresAt: now + 10 * 60_000,
  });
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: attempt.clientId ?? "dynamic_agent_client",
    ext_agent_host_id: hostId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES,
    resource: RESOURCE,
    state,
    nonce: attempt.nonce,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  }).toString();
  if (!registration) url.searchParams.set("agent_name_hint", "DurinDoor");
  if (registration?.idToken) url.searchParams.set("id_token_hint", registration.idToken);
  if (registration?.email) url.searchParams.set("login_hint", registration.email);
  return { attempt, authorizationUrl: url.href };
}

export function parseChatGptPlanCallback(attempt, callbackUrl, now = Date.now()) {
  const prefix = `${attempt.redirectUri}?`;
  if (!isString(callbackUrl) || callbackUrl.length > 16_384 ||
      !callbackUrl.startsWith(prefix) || /[#\u0000-\u0020\u007f]/.test(callbackUrl) ||
      /%(?![0-9a-f]{2})/i.test(callbackUrl) || now >= attempt.expiresAt) {
    throw new ChatGptPlanOAuthError("invalid_callback");
  }
  const params = new URL(callbackUrl).searchParams;
  for (const field of ["state", "code", "client_id", "error", "iss"]) {
    if (params.getAll(field).length > 1) throw new ChatGptPlanOAuthError("invalid_callback");
  }
  if (params.get("state") !== attempt.state || (params.has("iss") && params.get("iss") !== ISSUER)) {
    throw new ChatGptPlanOAuthError("invalid_callback");
  }
  if (params.has("error")) {
    throw new ChatGptPlanOAuthError(params.get("error") === "access_denied" ? "access_denied" : "authorization_failed");
  }
  const code = params.get("code");
  const clientId = params.get("client_id") ?? attempt.clientId;
  if (!nonempty(code) || !issuedClient(clientId) || (attempt.clientId && clientId !== attempt.clientId)) {
    throw new ChatGptPlanOAuthError("invalid_callback");
  }
  return { code, clientId };
}

async function readBody(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    let size = 0;
    let content = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new ChatGptPlanOAuthError("invalid_response");
      content += decoder.decode(value, { stream: true });
    }
    return content + decoder.decode();
  } catch {
    void reader.cancel().catch(() => {});
    throw new ChatGptPlanOAuthError("invalid_response");
  } finally {
    reader.releaseLock();
  }
}

async function readJson(response, limit) {
  try {
    const data = JSON.parse(await readBody(response, limit));
    if (isRecord(data)) return data;
  } catch {
    // Parsing and transport errors may contain response contents.
  }
  throw new ChatGptPlanOAuthError("invalid_response");
}

async function request(fetchAdapter, url, form) {
  let response;
  try {
    response = await fetchAdapter(url, {
      method: form ? "POST" : "GET",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: "application/json",
        ...(form && { "Content-Type": "application/x-www-form-urlencoded" }),
      },
      body: form && new URLSearchParams(form),
    });
  } catch {
    throw new ChatGptPlanOAuthError("transport_failed");
  }
  if (response.status !== 200) {
    const body = await readJson(response, 8192).catch(() => null);
    const code = isString(body?.error) ? body.error : body?.error?.code;
    throw new ChatGptPlanOAuthError(ERROR_CODES.has(code) ? code : "request_failed", response.status);
  }
  return response;
}

function parseCredentials(data, now, previous) {
  const { access_token, refresh_token, token_type, expires_in, scope, earliest_refresh_at } = data;
  const expiresAt = now + expires_in * 1000;
  const earliestRefreshAt = earliest_refresh_at === undefined ? null :
    isNumber(earliest_refresh_at) ? earliest_refresh_at * 1000 :
      isString(earliest_refresh_at) ? Date.parse(earliest_refresh_at) : NaN;
  const scopes = scope === undefined && previous ? previous.scopes :
    isString(scope) && /^(?:[\x21\x23-\x5b\x5d-\x7e]+(?: [\x21\x23-\x5b\x5d-\x7e]+)*)?$/.test(scope)
      ? [...new Set(scope.split(" ").filter(Boolean))] : null;

  if ("error" in data || !nonempty(access_token) || (!isString(token_type) || token_type.toLowerCase() !== "bearer") ||
      !Number.isSafeInteger(expires_in) || expires_in <= 0 || !Number.isSafeInteger(expiresAt) ||
      (earliestRefreshAt !== null && (!Number.isSafeInteger(earliestRefreshAt) || earliestRefreshAt < 0)) ||
      !Array.isArray(scopes) ||
      (refresh_token !== undefined && !nonempty(refresh_token)) ||
      ((previous || scopes.includes("offline_access")) && !nonempty(refresh_token)) ||
      (previous && refresh_token === previous.refreshToken)) {
    throw new ChatGptPlanOAuthError("invalid_response");
  }
  return {
    accessToken: access_token,
    refreshToken: refresh_token,
    tokenType: "Bearer",
    scopes,
    planEnabled: scopes.includes(PLAN_SCOPE) && scopes.includes("resource.invoke"),
    savedAt: now,
    expiresAt,
    earliestRefreshAt,
  };
}

async function verifyIdentity(fetchAdapter, idToken, { clientId, nonce, subject }, clock) {
  if (!nonempty(idToken)) throw new ChatGptPlanOAuthError("invalid_identity");
  const keys = await readJson(await request(fetchAdapter, JWKS_URL), 65_536);
  try {
    const { payload } = await jwtVerify(idToken, createLocalJWKSet(keys), {
      issuer: ISSUER,
      audience: clientId,
      algorithms: ["RS256"],
      requiredClaims: ["sub", "iat", "exp", "nonce"],
      currentDate: new Date(clock()),
    });
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const needsAuthorizedParty = audiences.length > 1 || payload.azp !== undefined;
    if (payload.nonce !== nonce || !nonempty(payload.sub) ||
        !Number.isFinite(payload.exp) || !Number.isFinite(payload.iat) ||
        audiences.some((audience) => !nonempty(audience)) ||
        (subject !== undefined && payload.sub !== subject) ||
        (needsAuthorizedParty && payload.azp !== clientId)) {
      throw new Error();
    }
    return {
      issuer: ISSUER,
      subject: payload.sub,
      email: payload.email_verified === true && nonempty(payload.email) ? payload.email : undefined,
    };
  } catch {
    throw new ChatGptPlanOAuthError("invalid_identity");
  }
}

function validateSession(record) {
  if (!issuedClient(record.clientId) || record.issuer !== ISSUER ||
      !nonempty(record.subject) || !nonempty(record.refreshToken)) {
    throw new ChatGptPlanOAuthError("invalid_registration");
  }
}

export function createChatGptPlanProtocol({ fetchAdapter, clock = Date.now }) {
  if (!isFunction(fetchAdapter)) throw new ChatGptPlanOAuthError("invalid_transport");
  return {
    async exchangeCode(attempt, callbackUrl) {
      const { code, clientId } = parseChatGptPlanCallback(attempt, callbackUrl, clock());
      const data = await readJson(await request(fetchAdapter, TOKEN_URL, {
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: attempt.codeVerifier,
        redirect_uri: attempt.redirectUri,
        resource: RESOURCE,
      }), 65_536);
      const now = clock();
      const credentials = parseCredentials(data, now);
      const identity = await verifyIdentity(fetchAdapter, data.id_token, { ...attempt, clientId }, clock);
      return { ...identity, ...credentials, clientId, hostId: attempt.hostId, idToken: data.id_token };
    },

    async refresh(record) {
      validateSession(record);
      const data = await readJson(await request(fetchAdapter, TOKEN_URL, {
        grant_type: "refresh_token",
        client_id: record.clientId,
        refresh_token: record.refreshToken,
        resource: RESOURCE,
      }), 65_536);
      if (data.id_token !== undefined && !nonempty(data.id_token)) {
        throw new ChatGptPlanOAuthError("invalid_response");
      }
      return { ...record, ...parseCredentials(data, clock(), record) };
    },

    async revoke(record) {
      validateSession(record);
      const response = await request(fetchAdapter, REVOCATION_URL, {
        token: record.refreshToken,
        token_type_hint: "refresh_token",
        client_id: record.clientId,
      });
      await readBody(response, 0);
    },
  };
}
