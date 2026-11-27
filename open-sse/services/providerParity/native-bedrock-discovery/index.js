// Private Bedrock model discovery over the real AWS control-plane SDK (#2034).
//
// Ported from OmniRoute (MIT, Copyright (c) 2026 Cheaper Inference - Created by
// Diego Souza), commit 3a17f7e908308a217887a7617c2c793b95ea83c0,
// open-sse/services/bedrock.ts `discoverBedrockNativeModels`. The source lists text foundation
// models, then pages system-defined inference profiles, keeps profile failures other than auth
// as warnings, and signs with a hand-rolled SigV4 helper for static IAM keys. Here signing,
// bearer auth and serialization are the AWS SDK's (`@aws-sdk/client-bedrock`), and the
// credentials come from the same helper the Bedrock executor uses, so the three DurinDoor
// modes keep their existing meaning:
//
// - apiKey:  Bedrock API key, sent only as `Authorization: Bearer`. Never used as an AWS secret.
// - static:  access key id + secret (+ the encrypted top-level session token), SigV4 only.
//            The secret is never sent as a bearer token.
// - profile: a named local profile resolved by the SDK's `fromIni`. Not in the source, which
//            has no profile mode; it is supported because the executor already supports it.
//
// Private and unregistered: nothing imports this module outside its tests. Public
// registration and promotion are owned elsewhere (see manifest.json).
//
// Limits of the evidence: tests run the real SDK serializer, signer and deserializer with the
// network transport and `fromIni` mocked. No request has been sent to AWS from this code.
import { BedrockClient, ListFoundationModelsCommand, ListInferenceProfilesCommand } from "@aws-sdk/client-bedrock";
import { Readable } from "node:stream";
import { BEDROCK_CREDENTIAL_MODE, resolveBedrockRegion } from "../../../config/bedrock.js";
import { buildBedrockClientAuth, detectBedrockCredentialMode } from "../../../shared/awsCredentials.js";
import { readBoundedResponseText } from "../../../utils/error.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  BedrockDiscoveryResponseError,
  normalizeBedrockDiscoveredModels,
  validateFoundationModels,
  validateInferenceProfilePage,
} from "./normalize.js";

export const BEDROCK_DISCOVERY_DEFAULT_TIMEOUT_MS = 30_000;
export const BEDROCK_DISCOVERY_MAX_TIMEOUT_MS = 60_000;
export const BEDROCK_DISCOVERY_MAX_PROFILE_PAGES = 10;
export const BEDROCK_DISCOVERY_MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_NEXT_TOKEN_LENGTH = 4096;

// AWS hosts a profile's credential chain may call through the parent client's handler (STS
// AssumeRole and IAM Identity Center). Only reachable in profile mode.
const CREDENTIAL_HOST_PATTERN = /^(?:sts|portal\.sso|oidc)(?:\.[a-z0-9-]+)?\.amazonaws\.com$/;
// fetch derives these from the URL; a relay must not inherit the signed Host.
const FETCH_OWNED_HEADERS = new Set(["host", "content-length", "connection", "expect", "transfer-encoding"]);
const CREDENTIAL_PROVIDER_ERRORS = new Set(["CredentialsProviderError", "TokenProviderError"]);
const AUTH_ERROR_NAMES = new Set([
  "AccessDeniedException",
  "UnrecognizedClientException",
  "ExpiredTokenException",
  "InvalidSignatureException",
  "IncompleteSignature",
  "MissingAuthenticationTokenException",
]);
const QUOTA_ERROR_NAMES = new Set(["ThrottlingException", "ServiceQuotaExceededException", "TooManyRequestsException"]);

const MESSAGES = {
  auth: "Bedrock refused the credentials for model discovery",
  credentialProvider:
    "AWS credentials for this connection could not be resolved. Check the profile, and for SSO " +
    "run `aws sso login` on the server.",
  quota: "Bedrock rate limited or exhausted quota for model discovery",
  config: "Bedrock rejected the model discovery request for this connection's configuration",
  upstream: "Bedrock model discovery failed upstream",
  refused: "Bedrock model discovery refused a redirect or an unexpected origin",
  unavailable: "Bedrock model discovery transport unavailable",
  aborted: "Bedrock model discovery was cancelled",
  timeout: "Bedrock model discovery timed out",
};

/**
 * A discovery failure safe to show to a client: a fixed message, a category, an HTTP status
 * and an error code. Upstream bodies, credential-provider output and secrets never reach it.
 */
export class BedrockDiscoveryError extends Error {
  constructor(kind, status, message, code) {
    super(message);
    this.name = "BedrockDiscoveryError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

const trimmed = (value) => (isString(value) ? value.trim() : "");
const safeCode = (name, status) => (isString(name) && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : `HTTP_${status}`);

function refusingIdentity(name, message) {
  return async () => {
    throw Object.assign(new Error(message), { name });
  };
}

/** Whether a request target is one this discovery may send to. */
function allowedTarget(target, origin, allowCredentialHosts) {
  if (target.origin === origin) return true;
  return allowCredentialHosts && target.protocol === "https:" && !target.port &&
    CREDENTIAL_HOST_PATTERN.test(target.hostname);
}

function discard(response) {
  void response?.body?.cancel?.().catch(() => {});
}

function refusal(reason) {
  return new BedrockDiscoveryError("refused", 502, MESSAGES.refused, reason);
}

function waitFor(promise, signal) {
  if (!signal) return promise;
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([promise, aborted]).finally(() => {
    signal.removeEventListener("abort", onAbort);
    aborted.catch(() => {});
  });
}

/**
 * SDK HTTP handler bound to one discovery: fixed origin, no redirects, caller abort plus the
 * discovery deadline, and a bounded body read. The SDK signs before it calls `handle`.
 */
function createDiscoveryRequestHandler({ origin, allowCredentialHosts, transport, signal, end }) {
  return {
    metadata: { handlerProtocol: "http/1.1" },
    async handle(request, { abortSignal } = {}) {
      const target = new URL(`${request.protocol}//${request.hostname}${request.port ? `:${request.port}` : ""}${request.path}`);
      for (const [name, value] of Object.entries(request.query || {})) {
        for (const item of [value].flat()) target.searchParams.append(name, item ?? "");
      }
      if (!allowedTarget(target, origin, allowCredentialHosts)) throw refusal("OriginRefused");
      const headers = Object.fromEntries(
        Object.entries(request.headers || {}).filter(([name]) => !FETCH_OWNED_HEADERS.has(name.toLowerCase()))
      );
      const fetchSignal = abortSignal ? AbortSignal.any([signal, abortSignal]) : signal;
      if (fetchSignal.aborted) throw fetchSignal.reason;
      const pending = Promise.resolve().then(() => transport(target.toString(), {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual",
        signal: fetchSignal,
      }));
      let response;
      try {
        response = await waitFor(pending, fetchSignal);
      } catch (error) {
        pending.then(discard, () => {});
        throw error;
      }
      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
        discard(response);
        throw refusal("RedirectRefused");
      }
      let answeredBy = target.origin;
      try {
        if (response.url) answeredBy = new URL(response.url).origin;
      } catch {
        answeredBy = null;
      }
      if (response.redirected || answeredBy !== target.origin) {
        discard(response);
        throw refusal("ForeignOrigin");
      }
      const text = await readBoundedResponseText(response, {
        signal: fetchSignal,
        maxBytes: BEDROCK_DISCOVERY_MAX_BODY_BYTES,
        timeoutMs: Math.max(1, end - Date.now()),
        throwOnTimeout: true,
      });
      return {
        response: {
          statusCode: response.status,
          reason: response.statusText,
          headers: Object.fromEntries(response.headers),
          body: Readable.from([Buffer.from(text, "utf8")]),
        },
      };
    },
    updateHttpClientConfig() {},
    httpHandlerConfigs() {
      return {};
    },
    destroy() {},
  };
}

/** Map any failure to a redacted BedrockDiscoveryError. */
function toDiscoveryError(error, state) {
  if (state.timedOut) return new BedrockDiscoveryError("timeout", 504, MESSAGES.timeout, "TimeoutError");
  if (state.callerAborted) return new BedrockDiscoveryError("aborted", 499, MESSAGES.aborted, "AbortError");
  if (error instanceof BedrockDiscoveryError) return error;
  if (error instanceof BedrockDiscoveryResponseError) {
    return new BedrockDiscoveryError("invalid_response", 502, error.message, "InvalidResponse");
  }
  // Thrown by the shared credential helper before anything is sent; its messages are fixed,
  // actionable and never quote a secret.
  if (error?.name === "InvalidCredentials") {
    return new BedrockDiscoveryError("auth", 401, error.message, "InvalidCredentials");
  }
  if (CREDENTIAL_PROVIDER_ERRORS.has(error?.name)) {
    return new BedrockDiscoveryError("auth", 401, MESSAGES.credentialProvider, error.name);
  }
  const status = Number(error?.$metadata?.httpStatusCode);
  const name = error?.name;
  if (status === 401 || status === 403 || AUTH_ERROR_NAMES.has(name)) {
    const code = safeCode(name, status || 401);
    return new BedrockDiscoveryError("auth", status === 403 ? 403 : 401, MESSAGES.auth, code);
  }
  if (status === 429 || status === 402 || QUOTA_ERROR_NAMES.has(name)) {
    return new BedrockDiscoveryError("quota", status === 402 ? 402 : 429, MESSAGES.quota, safeCode(name, status || 429));
  }
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return new BedrockDiscoveryError("config", status, MESSAGES.config, safeCode(name, status));
  }
  if (Number.isInteger(status) && status >= 500) {
    return new BedrockDiscoveryError("upstream", 502, MESSAGES.upstream, safeCode(name, status));
  }
  return new BedrockDiscoveryError("unavailable", 502, MESSAGES.unavailable, "TransportUnavailable");
}

/** Profile-page failures that end discovery instead of becoming a warning (source: auth only). */
const FATAL_PROFILE_KINDS = new Set(["auth", "refused", "aborted", "timeout"]);

async function listInferenceProfiles(client, sendOptions) {
  const profiles = [];
  const seen = new Set();
  let nextToken;
  for (let page = 0; page < BEDROCK_DISCOVERY_MAX_PROFILE_PAGES; page++) {
    const output = await client.send(new ListInferenceProfilesCommand({
      maxResults: 100,
      typeEquals: "SYSTEM_DEFINED",
      ...(nextToken ? { nextToken } : {}),
    }), sendOptions);
    profiles.push(...validateInferenceProfilePage(output));
    const token = output?.nextToken;
    if (token === undefined || token === null || token === "") return profiles;
    if (!isString(token) || token.length > MAX_NEXT_TOKEN_LENGTH || seen.has(token)) {
      throw new BedrockDiscoveryResponseError("Bedrock returned an invalid inference profile page token");
    }
    seen.add(token);
    nextToken = token;
  }
  throw new BedrockDiscoveryResponseError("Bedrock inference profile pagination exceeded the page limit");
}

/**
 * List the text models and system inference profiles one Bedrock connection can see.
 *
 * Read-only control-plane calls (ListFoundationModels, ListInferenceProfiles): nothing is
 * invoked or billed. The request goes to `https://bedrock.<region>.amazonaws.com` for the
 * connection's region, through the connection's proxy settings, signed or bearer-authenticated
 * by the AWS SDK. `timeoutMs` bounds everything: credential resolution, every page and every
 * body read.
 *
 * @param {object} options
 * @param {object} options.credentials - The selected connection (apiKey, sessionToken, providerSpecificData).
 * @param {object} [options.proxyOptions] - Explicit proxy options, merged over the connection's own.
 * @param {AbortSignal} [options.signal] - Caller cancellation.
 * @param {number} [options.timeoutMs] - Total deadline, capped at BEDROCK_DISCOVERY_MAX_TIMEOUT_MS.
 * @param {Function} [options.fetch] - Network transport `(url, init) => Response`; defaults to proxyAwareFetch.
 * @returns {Promise<{ region: string, mode: string, models: object[], warnings: string[] }>}
 * @throws {BedrockDiscoveryError}
 */
export async function discoverBedrockModels({
  credentials,
  proxyOptions = null,
  signal = null,
  timeoutMs = BEDROCK_DISCOVERY_DEFAULT_TIMEOUT_MS,
  fetch: transport = null,
} = {}) {
  const state = { timedOut: false, callerAborted: false };
  if (signal?.aborted) {
    state.callerAborted = true;
    throw toDiscoveryError(signal.reason, state);
  }

  const region = resolveBedrockRegion(credentials?.providerSpecificData);
  const origin = `https://bedrock.${region}.amazonaws.com`;
  const mode = detectBedrockCredentialMode(credentials);
  // A session token belongs to an AWS key pair. Without an access key id the API key field is
  // a Bedrock API key, and pairing it with a session token would mean reading it as a secret.
  if (mode === BEDROCK_CREDENTIAL_MODE.API_KEY && trimmed(credentials?.sessionToken)) {
    throw new BedrockDiscoveryError(
      "config",
      400,
      "A session token needs an AWS access key id. Add the access key id, or remove the session token to use a Bedrock API key.",
      "InvalidCredentials"
    );
  }

  let auth;
  try {
    auth = buildBedrockClientAuth(credentials);
  } catch (error) {
    throw toDiscoveryError(error, state);
  }
  // Pin the auth scheme to the connection's mode so the SDK can never fall back to an
  // ambient credential (environment bearer token, SSO token cache, instance metadata).
  const modeGuard = mode === BEDROCK_CREDENTIAL_MODE.API_KEY ?
  { credentials: refusingIdentity("CredentialsProviderError", "SigV4 is not used for a Bedrock API key connection") } :
  {
    token: refusingIdentity("TokenProviderError", "Bearer auth is not used for an AWS credential connection"),
    authSchemePreference: ["sigv4"],
  };

  const total = Math.min(BEDROCK_DISCOVERY_MAX_TIMEOUT_MS, Math.max(1, Number(timeoutMs) || BEDROCK_DISCOVERY_DEFAULT_TIMEOUT_MS));
  const end = Date.now() + total;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    state.timedOut = true;
    controller.abort(Object.assign(new Error("Bedrock discovery deadline"), { name: "TimeoutError" }));
  }, total);
  const onCallerAbort = () => {
    state.callerAborted = true;
    controller.abort(signal.reason);
  };
  signal?.addEventListener("abort", onCallerAbort, { once: true });

  const send = transport ?? ((url, init) => proxyAwareFetch(url, init, resolveCredentialProxyOptions(credentials, proxyOptions)));
  const client = new BedrockClient({
    region,
    endpoint: origin,
    useFipsEndpoint: false,
    useDualstackEndpoint: false,
    maxAttempts: 1,
    retryMode: "standard",
    defaultsMode: "standard",
    ...modeGuard,
    ...auth,
    requestHandler: createDiscoveryRequestHandler({
      origin,
      allowCredentialHosts: mode === BEDROCK_CREDENTIAL_MODE.PROFILE,
      transport: send,
      signal: controller.signal,
      end,
    }),
  });
  const sendOptions = { abortSignal: controller.signal };

  const work = (async () => {
    const foundation = validateFoundationModels(
      await client.send(new ListFoundationModelsCommand({ byOutputModality: "TEXT" }), sendOptions)
    );
    const warnings = [];
    let profiles = [];
    try {
      profiles = await listInferenceProfiles(client, sendOptions);
    } catch (error) {
      const mapped = toDiscoveryError(error, state);
      if (FATAL_PROFILE_KINDS.has(mapped.kind)) throw mapped;
      warnings.push(`Bedrock inference profiles unavailable (${mapped.code})`);
    }
    return { region, mode, models: normalizeBedrockDiscoveredModels(foundation, profiles), warnings };
  })();
  work.catch(() => {});

  try {
    // The race keeps the deadline binding even if a credential provider ignores the signal.
    return await waitFor(work, controller.signal);
  } catch (error) {
    throw toDiscoveryError(error, state);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
    if (!controller.signal.aborted) controller.abort(new Error("Bedrock discovery finished"));
    client.destroy();
  }
}
