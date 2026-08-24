// HTTP/SSE upstream MCP client for the gateway.

import { getProviderConnectionById } from "@/lib/db/repos/connectionsRepo.js";
import { resolveProviderId } from "@/shared/constants/providers.js";
import { ensureFreshToken, oauthMetaFromTokens, refreshToken } from "./oauthRefresh";
import { retryWithBackoff } from "./retry";
import { isJsonRpcResponse, isRecord } from "./guards";
import { assertOutboundUrlAllowed, OutboundUrlGuardError } from "open-sse/utils/outboundUrlGuard.js";
import { updateInstance, getInstanceById } from "@/lib/localDb";
import { isObject, isString } from "../../../shared/utils/typeChecks.js";

const TIMEOUT_MS = 30_000;
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const HTTP_SESSION_KEY = "__9routerGatewayHttpSessions";
const MAX_REDIRECT_HOPS = 5;

// JSON-RPC request ids. `initialize` hardcodes id 1 (spec: ids only need to
// be unique within a connection); every post-init request allocates from the
// per-connection counter on the session entry (see getSessionEntry). The
// counter lives in the globalThis-backed store, not module scope, so HMR /
// worker module reloads can never reset it back onto in-flight ids.
const INITIALIZE_ID = 1;

function getSessionStore() {
  if (!globalThis[HTTP_SESSION_KEY]) {
    globalThis[HTTP_SESSION_KEY] = new Map();
  }
  return globalThis[HTTP_SESSION_KEY];
}

function getSessionEntry(instance) {
  const store = getSessionStore();
  if (!store.has(instance.id)) {
    store.set(instance.id, {
      sessionId: null,
      protocolVersion: null,
      serverInfo: null,
      initPromise: null,
      nextRequestId: INITIALIZE_ID + 1
    });
  }
  return store.get(instance.id);
}

function clearSessionEntry(instance) {
  getSessionStore().delete(instance.id);
}

export class McpAuthError extends Error {
  constructor(message, { status, slug, body, freshTokens } = {}) {
    super(message);
    this.name = "McpAuthError";
    this.status = status;
    this.slug = slug;
    this.body = body;
    this.freshTokens = freshTokens;
  }
}

function safeParseJson(s) {
  if (!s) return null;
  try {return JSON.parse(s);} catch {return null;}
}

function parseResponsePayload(res, text) {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    const out = [];
    const dataLines = text.split("\n").filter((l) => l.startsWith("data:"));
    for (const line of dataLines) {
      const obj = safeParseJson(line.replace(/^data:\s*/, ""));
      if (obj) out.push(obj);
    }
    return out;
  }
  const parsed = safeParseJson(text);
  return parsed !== null ? [parsed] : [];
}

function readAuthFromInstance(instance) {
  const t = instance?.oauthTokens;
  if (!t || !isObject(t)) return null;
  if (t.needsReauth) return null;
  const tok = t.access_token ?? t.accessToken;
  return isString(tok) ? tok : null;
}

function markNeedsReauth(instance) {
  return {
    ...instance,
    oauthTokens: { ...(instance.oauthTokens ?? {}), needsReauth: true }
  };
}

function clearReauthFlag(instance) {
  if (!instance?.oauthTokens) return instance;
  const { needsReauth, ...rest } = instance.oauthTokens;
  return { ...instance, oauthTokens: rest };
}
async function buildHeaders(instance) {
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": DEFAULT_PROTOCOL_VERSION
  };
  if (instance.headers && isObject(instance.headers)) {
    for (const [k, v] of Object.entries(instance.headers)) {
      const kl = k.toLowerCase();
      if (kl === "content-type" || kl === "accept" || kl.startsWith("mcp-")) continue;
      headers[k] = String(v);
    }
  }
  // Inject Authorization: Bearer for connection-backed instances. Only the z.ai
  // MCP endpoint currently uses this mechanism; the URL is checked so a
  // stray connection id cannot be used to leak the apiKey to an arbitrary host.
  if (instance.providerConnectionId) {
    const conn = await getProviderConnectionById(instance.providerConnectionId).catch(() => null);
    const canonical = conn ? resolveProviderId(conn.provider) : null;
    if (canonical === "zai" && conn?.apiKey && (instance.url || "").startsWith("https://api.z.ai/api/mcp/")) {
      headers.Authorization = `Bearer ${conn.apiKey}`;
      return headers;
    }
  }
  const token = readAuthFromInstance(instance);
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Perform an MCP JSON-RPC POST against an upstream and return the first
 * matching response frame. Throws McpAuthError on 401/403.
 *
 * OAuth instances: before the request, a stale access token is refreshed via
 * {@link ensureFreshToken}. If the upstream still returns 401, the request
 * is force-refreshed once via {@link refreshToken} and retried with the new
 * token. Non-OAuth instances do not retry 401s.
 *
 * @param {object} instance   parsed mcpInstances row
 * @param {object} jsonRpc    {jsonrpc, id, method, params}
 * @param {object} [opts]     {sessionId, timeoutMs, skipRetry}
 * @returns {Promise<object>} JSON-RPC response with injected sessionId
 */
export async function mcpRequest(instance, jsonRpc, opts = {}) {
  const doRequest = async (currentInstance, { persistAuthFailure = false } = {}) => {
    if (!currentInstance?.url) {
      throw new Error(`instance ${currentInstance?.slug ?? "?"} has no url`);
    }

    let url = currentInstance.url;

    if (currentInstance.oauth) {
      const meta = oauthMetaFromTokens(currentInstance.oauthTokens);
      currentInstance = await ensureFreshToken(currentInstance, meta);
      if (currentInstance.oauthTokens?.needsReauth) {
        throw new McpAuthError(`upstream requires re-login: ${currentInstance.slug}`, {
          status: 401,
          ...(currentInstance.slug !== undefined ? { slug: currentInstance.slug } : null)
        });
      }
      if (currentInstance.url) url = currentInstance.url;
    }

    const ac = new AbortController();
    const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const headers = await buildHeaders(currentInstance);
      if (opts.sessionId) headers["mcp-session-id"] = opts.sessionId;

      // SSRF / redirect handling. We do NOT let the runtime auto-follow
      // redirects: a hostile (or compromised) upstream can 3xx the
      // JSON-RPC POST to an arbitrary host and, with auto-follow, would
      // receive the Authorization bearer we attached. Two rules on
      // EVERY hop:
      //   1. redirect:"manual" + assertOutboundUrlAllowed() — re-validate
      //      the Location against the SSRF guard before opening the
      //      socket.
      //   2. strip Authorization + other sensitive caller-supplied
      //      headers whenever the redirect crosses origin. Same-origin
      //      redirects keep them.
      let currentUrl = url;
      let currentHeaders = headers;
      let res = null;
      for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
        let fetchRes;
        try {
          fetchRes = await fetch(currentUrl, {
            method: "POST",
            headers: currentHeaders,
            body: JSON.stringify(jsonRpc),
            signal: ac.signal,
            redirect: "manual"
          });
        } catch (err) {
          if (err instanceof OutboundUrlGuardError) {
            throw Object.assign(new Error("URL not allowed"), { blocked: true, original: err });
          }
          throw err;
        }

        res = fetchRes;
        if (!(res.status >= 300 && res.status < 400)) break;

        const location = res.headers.get("location");
        if (!location) break;

        let next;
        try {
          next = new URL(location, currentUrl);
        } catch {
          break;
        }

        try {
          assertOutboundUrlAllowed(next);
        } catch (err) {
          if (err instanceof OutboundUrlGuardError) {
            throw Object.assign(new Error("URL not allowed"), { blocked: true, original: err });
          }
          throw err;
        }

        const prevOrigin = new URL(currentUrl).origin;
        if (next.origin !== prevOrigin) {
          const stripped = { ...currentHeaders };
          delete stripped.Authorization;
          delete stripped.authorization;
          delete stripped.Cookie;
          delete stripped.cookie;
          delete stripped["Proxy-Authorization"];
          delete stripped["proxy-authorization"];
          currentHeaders = stripped;
        }
        currentUrl = next.toString();
      }

      if (res.status === 401 || res.status === 403) {
        const body = await res.text().catch(() => "");
        if (currentInstance.oauth && currentInstance.id) {
          const sentToken = readAuthFromInstance(currentInstance);
          const latestRow = await getInstanceById(currentInstance.id).catch(() => null);
          const latestTokens = latestRow?.oauthTokens;
          const latestToken = isString(latestTokens?.access_token) ? latestTokens.access_token : null;
          // If another request has already refreshed and persisted a newer
          // usable token, do not clobber it with needsReauth. Hand the fresh
          // token up to the retry loop instead.
          if (latestToken && latestToken !== sentToken && !latestTokens.needsReauth) {
            throw new McpAuthError(`upstream ${res.status} for ${currentInstance.slug}`, {
              status: res.status,
              ...(currentInstance.slug !== undefined ? { slug: currentInstance.slug } : null),
              body: body.slice(0, 500),
              freshTokens: latestTokens
            });
          }
          // Do not persist needsReauth on the first 401; a concurrent
          // refresh may have already written a newer token that we just
          // failed to observe. The outer retry loop will re-read the DB,
          // reuse any in-flight refresh, or force-refresh itself, and only
          // then persist needsReauth if the retry also fails.
          if (persistAuthFailure) {
            const finalRow = await getInstanceById(currentInstance.id).catch(() => null);
            const finalTokens = finalRow?.oauthTokens;
            const finalToken = isString(finalTokens?.access_token) ? finalTokens.access_token : null;
            if (!finalToken || finalToken === sentToken || finalTokens.needsReauth) {
              const challenge = res.headers.get("www-authenticate");
              await updateInstance(currentInstance.id, {
                oauthTokens: {
                  ...(currentInstance.oauthTokens ?? {}),
                  needsReauth: true,
                  ...(challenge ? { _lastChallenge: challenge } : null)
                }
              }).catch(() => {});
            }
          }
        }
        throw new McpAuthError(`upstream ${res.status} for ${currentInstance.slug}`, {
          status: res.status,
          ...(currentInstance.slug !== undefined ? { slug: currentInstance.slug } : null),
          body: body.slice(0, 500)
        });
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const err = new Error(`upstream ${res.status} for ${currentInstance.slug}: ${body.slice(0, 200)}`);
        err.status = res.status;
        throw err;
      }

      const text = await res.text();
      const frames = parseResponsePayload(res, text);
      const sessionId = res.headers.get("mcp-session-id") ?? opts.sessionId ?? null;

      const reqId = "id" in jsonRpc ? jsonRpc.id : undefined;
      let frame = frames.find((f) => isJsonRpcResponse(f) && f.id === reqId);
      if (!frame) {
        frame = frames.find((f) => isJsonRpcResponse(f) && ("result" in f || "error" in f));
      }
      if (!frame) {
        const last = frames[frames.length - 1];
        frame = last ?? { jsonrpc: "2.0", id: reqId, result: null };
      }
      return { ...frame, sessionId };
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        throw new Error(`upstream ${currentInstance.slug} timed out after ${timeoutMs}ms`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };

  if (opts.skipRetry) {
    return doRequest(instance, { persistAuthFailure: true });
  }

  let currentInstance = instance;
  let didAuthRetry = false;

  const requestWithAuthRetry = async () => {
    try {
      return await doRequest(currentInstance);
    } catch (e) {
      if (e instanceof McpAuthError && e.status === 401 && currentInstance.oauth && !didAuthRetry) {
        didAuthRetry = true;
        if (e.freshTokens && !e.freshTokens.needsReauth && e.freshTokens.access_token) {
          currentInstance = { ...currentInstance, oauthTokens: e.freshTokens };
          return await doRequest(currentInstance, { persistAuthFailure: true });
        }
        // Sequence guard: re-read DB immediately before starting a forced
        // refresh. If another request has already refreshed while this one
        // was waiting for its stale 401, use the newer token instead of
        // refreshing with our stale refresh_token and potentially clobbering
        // the valid bundle.
        const preRefreshRow = await getInstanceById(currentInstance.id).catch(() => null);
        const preRefreshTokens = preRefreshRow?.oauthTokens;
        if (preRefreshTokens && !preRefreshTokens.needsReauth && preRefreshTokens.access_token && preRefreshTokens.access_token !== currentInstance.oauthTokens?.access_token) {
          currentInstance = { ...currentInstance, oauthTokens: preRefreshTokens };
          return await doRequest(currentInstance, { persistAuthFailure: true });
        }
        const refreshed = await refreshToken(currentInstance);
        if (refreshed && !refreshed.oauthTokens?.needsReauth) {
          currentInstance = refreshed;
          return await doRequest(currentInstance, { persistAuthFailure: true });
        }
        // A concurrent request may have refreshed while we awaited our
        // forced refresh. Read the DB once more before surfacing the 401.
        const latestRow = await getInstanceById(currentInstance.id).catch(() => null);
        const latestTokens = latestRow?.oauthTokens;
        if (latestTokens && !latestTokens.needsReauth && latestTokens.access_token) {
          currentInstance = { ...currentInstance, oauthTokens: latestTokens };
          return await doRequest(currentInstance, { persistAuthFailure: true });
        }
      }
      throw e;
    }
  };

  return retryWithBackoff(requestWithAuthRetry, {
    maxAttempts: 3,
    baseDelayMs: 100,
    onRetry: (err, attempt, delayMs) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[mcp-http:${instance.slug}] transient retry ${attempt + 1} after ${delayMs}ms: ${msg}`);
    }
  });
}

/**
 * Ensure the upstream has been initialized.
 * @param {object} instance
 * @param {object} [opts]
 * @returns {Promise<{protocolVersion: string, serverInfo: object | null, sessionId?: string}>}
 */
export async function ensureInitialized(instance, opts = {}) {
  const entry = getSessionEntry(instance);

  if (entry.sessionId && entry.protocolVersion && entry.serverInfo) {
    return {
      protocolVersion: entry.protocolVersion,
      serverInfo: entry.serverInfo,
      sessionId: entry.sessionId
    };
  }

  if (entry.initPromise) {
    return entry.initPromise;
  }

  entry.initPromise = (async () => {
    try {
      const initParams = {
        protocolVersion: opts.protocolVersion ?? DEFAULT_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "9router-gateway", version: "1" }
      };
      const resp = await mcpRequest(instance, {
        jsonrpc: "2.0", id: INITIALIZE_ID, method: "initialize", params: initParams
      });

      if ("error" in resp && resp.error !== undefined) {
        const errVal = resp.error;
        const msg = isRecord(errVal) && isString(errVal.message) ? errVal.message : JSON.stringify(errVal);
        throw new Error(`initialize failed for ${instance.slug}: ${msg}`);
      }

      await mcpRequest(instance, {
        jsonrpc: "2.0", method: "notifications/initialized", params: {}
      }, { ...(resp.sessionId ? { sessionId: resp.sessionId } : null), timeoutMs: 5000, skipRetry: true }).catch(() => {});

      const resultVal = "result" in resp ? resp.result : null;
      const resultObj = isRecord(resultVal) ? resultVal : null;
      const serverInfoRaw = resultObj?.serverInfo;
      const info = {
        protocolVersion: (isRecord(resultObj) && isString(resultObj.protocolVersion) ? resultObj.protocolVersion : null) ?? initParams.protocolVersion,
        serverInfo: isRecord(serverInfoRaw) && isString(serverInfoRaw.name) ?
        { name: serverInfoRaw.name, ...(isString(serverInfoRaw.version) ? { version: serverInfoRaw.version } : null) } :
        null,
        ...(resp.sessionId ? { sessionId: resp.sessionId } : null)
      };

      // Commit session state before clearing initPromise, so a concurrent
      // caller that awaited our initPromise sees a fully initialized entry.
      entry.sessionId = info.sessionId ?? null;
      entry.protocolVersion = info.protocolVersion;
      entry.serverInfo = info.serverInfo;
      entry.initPromise = null;

      return info;
    } catch (e) {
      clearSessionEntry(instance);
      throw e;
    }
  })();

  return entry.initPromise;
}

export async function listTools(instance, opts = {}) {
  const init = await ensureInitialized(instance, opts);
  const entry = getSessionEntry(instance);
  const resp = await mcpRequest(instance, {
    jsonrpc: "2.0", id: entry.nextRequestId++, method: "tools/list", params: opts.params ?? {}
  }, { ...(init.sessionId !== undefined ? { sessionId: init.sessionId } : null) });
  if ("error" in resp && resp.error !== undefined) {
    const errVal = resp.error;
    const msg = isRecord(errVal) && isString(errVal.message) ? errVal.message : JSON.stringify(errVal);
    throw new Error(`tools/list failed for ${instance.slug}: ${msg}`);
  }
  const result = "result" in resp ? resp.result : undefined;
  return result?.tools ?? [];
}

export async function callTool(instance, name, args, opts = {}) {
  const init = await ensureInitialized(instance, opts);
  const entry = getSessionEntry(instance);
  const resp = await mcpRequest(instance, {
    jsonrpc: "2.0",
    id: entry.nextRequestId++,
    method: "tools/call",
    params: { name, arguments: args ?? {} }
  }, { ...(init.sessionId !== undefined ? { sessionId: init.sessionId } : null) });
  if ("error" in resp && resp.error !== undefined) {
    const errVal = resp.error;
    const errMsg = isRecord(errVal) && isString(errVal.message) ? errVal.message : `tools/call failed for ${instance.slug}`;
    const e = new Error(errMsg);
    if (isRecord(errVal) && errVal.code !== undefined) e.code = errVal.code;
    if (isRecord(errVal) && errVal.data !== undefined) e.data = errVal.data;
    throw e;
  }
  return "result" in resp ? resp.result : undefined;
}

export const __test__ = {
  getSessionStore,
  getSessionEntry,
  clearSessionEntry
};