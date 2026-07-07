import crypto from "node:crypto";
import os from "node:os";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { BaseExecutor } from "./base.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

const BASE_URL = "https://api.xiaomimimo.com";
const BOOTSTRAP_PATH = "/api/free-ai/bootstrap";
const CHAT_PATH = "/api/free-ai/openai/chat";
const JWT_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const BOOTSTRAP_TIMEOUT_MS = 15_000;
const CHAT_TIMEOUT_MS = 60_000;
const COOLDOWN_BASE_MS = 5_000;
const COOLDOWN_MAX_MS = 60_000;
const MIMO_SOURCE = "mimocode-cli-free";

export const MIMO_SYSTEM_MARKER =
  "You are MiMoCode, an interactive CLI tool that helps users with software engineering tasks.";

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
];

const bootstrapInflight = new Map();
const dispatcherCache = new Map();

export function injectMimocodeSystemMarker(body) {
  const messages = body?.messages;
  if (!Array.isArray(messages)) return body;
  const hasMarker = messages.some(
    (message) =>
      message?.role === "system" &&
      typeof message.content === "string" &&
      message.content.includes(MIMO_SYSTEM_MARKER)
  );
  if (hasMarker) return body;
  return { ...body, messages: [{ role: "system", content: MIMO_SYSTEM_MARKER }, ...messages] };
}

function getCpuModel() {
  try {
    return os.cpus()?.[0]?.model?.trim() || "unknown-cpu";
  } catch {
    return "unknown-cpu";
  }
}

export function generateFingerprint(seed) {
  if (seed) return crypto.createHash("sha256").update(seed).digest("hex");
  let username = "unknown-user";
  try {
    username = os.userInfo().username;
  } catch {}
  return crypto
    .createHash("sha256")
    .update(`${os.hostname()}|${os.platform()}|${os.arch()}|${getCpuModel()}|${username}`)
    .digest("hex");
}

export function parseJwtExp(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    return (payload.exp || Math.floor(Date.now() / 1000) + 3000) * 1000;
  } catch {
    return Date.now() + 50 * 60 * 1000;
  }
}

function isAccountReady(account) {
  return account.cooldownUntil <= Date.now() && account.jwt && account.expiresAt - Date.now() > JWT_REFRESH_BUFFER_MS;
}

function rewriteModelName(model) {
  const id = String(model || "mimo-auto");
  const idx = id.lastIndexOf("/");
  return idx >= 0 ? id.slice(idx + 1) : id;
}

function createDispatcher(proxyUrl) {
  if (!proxyUrl) return undefined;
  if (!dispatcherCache.has(proxyUrl)) {
    dispatcherCache.set(proxyUrl, new ProxyAgent({ uri: proxyUrl }));
  }
  return dispatcherCache.get(proxyUrl);
}

function findAccountProxy(fingerprint, accountProxies) {
  const entry = accountProxies.find((item) => item?.fingerprint === fingerprint);
  return entry?.proxy ?? null;
}

function proxyConfigToUrl(entry) {
  const proxy = entry?.proxy;
  if (!entry?.fingerprint || !proxy?.host) return null;
  const type = proxy.type || "http";
  if (type !== "http" && type !== "https") {
    throw new Error(`Mimocode per-account proxy type "${type}" is not supported in this DurinDoor port; use http/https or add a fetch-socks dispatcher.`);
  }
  const port = proxy.port ?? (type === "https" ? 443 : 8080);
  const auth = proxy.username
    ? `${encodeURIComponent(proxy.username)}:${proxy.password ? encodeURIComponent(proxy.password) : ""}@`
    : "";
  return { fingerprint: entry.fingerprint, url: `${type}://${auth}${proxy.host}:${port}` };
}

function isAbortError(error) {
  if (!error) return false;
  if (error.name === "AbortError") return true;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return String(error.message || "").includes("AbortError");
}

async function raceWithSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) {
    throw signal.reason || new DOMException("Aborted", "AbortError");
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason || new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (reason) => {
        signal.removeEventListener("abort", onAbort);
        reject(reason);
      }
    );
  });
}

async function bootstrapJwt(baseUrl, fingerprint, signal, dispatcher, proxyOptions = null) {
  const existing = bootstrapInflight.get(fingerprint);
  if (existing) return raceWithSignal(existing, signal);

  const controller = new AbortController();
  let timer;
  const abortWithTimeout = () => controller.abort(new Error(`Mimocode bootstrap timed out after ${BOOTSTRAP_TIMEOUT_MS}ms`));
  timer = setTimeout(abortWithTimeout, BOOTSTRAP_TIMEOUT_MS);

  const promise = (async () => {
    try {
      const url = `${baseUrl.replace(/\/$/, "")}${BOOTSTRAP_PATH}`;
      const init = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        },
        body: JSON.stringify({ client: fingerprint }),
        signal: controller.signal,
      };
      const response = dispatcher
        ? await undiciFetch(url, { ...init, dispatcher })
        : await proxyAwareFetch(url, init, proxyOptions);
      if (!response.ok) {
        const status = response.status;
        const text = await response.text().catch(() => "");
        const error = Object.assign(new Error(`Bootstrap failed: ${status} ${text.slice(0, 200)}`), { status });
        throw error;
      }
      const data = await response.json();
      if (!data?.jwt) throw new Error("Bootstrap response missing jwt field");
      return { jwt: data.jwt, expiresAt: parseJwtExp(data.jwt) };
    } finally {
      clearTimeout(timer);
      bootstrapInflight.delete(fingerprint);
    }
  })();

  bootstrapInflight.set(fingerprint, promise);
  return raceWithSignal(promise, signal);
}

export class MimocodeExecutor extends BaseExecutor {
  constructor() {
    super("mimocode", { format: "openai", noAuth: true, baseUrl: BASE_URL });
    this.baseUrl = BASE_URL;
    this.accounts = [this.buildAccount(generateFingerprint())];
    this.nextAccountIdx = 0;
    this.proxyUrlMap = new Map();
    // Per-connection state cache keyed by connection id, so concurrent requests
    // for different stored Mimocode connections do not mutate shared account lists
    // or proxy maps.
    this.stateCache = new Map();
  }

  getState(credentials = {}) {
    const key = credentials.connectionId || credentials.id || "";
    if (!key) return this;
    if (!this.stateCache.has(key)) {
      this.stateCache.set(key, {
        accounts: [this.buildAccount(generateFingerprint())],
        nextAccountIdx: 0,
        proxyUrlMap: new Map(),
      });
    }
    return this.stateCache.get(key);
  }

  buildAccount(fingerprint) {
    return { fingerprint, jwt: "", expiresAt: 0, cooldownUntil: 0, consecutiveFails: 0, proxy: null };
  }

  _getProxyDispatcher(state, fingerprint) {
    return createDispatcher(state.proxyUrlMap.get(fingerprint));
  }

  _fetchWithProxy(state, url, init, fingerprint, proxyOptions = null) {
    const dispatcher = this._getProxyDispatcher(state, fingerprint);
    if (dispatcher) return undiciFetch(url, { ...init, dispatcher });
    return proxyAwareFetch(url, init, proxyOptions);
  }

  syncAccountsFromCredentials(credentials = {}) {
    return this._syncAccountsFromCredentials(this.getState(credentials), credentials);
  }

  _syncAccountsFromCredentials(state, credentials = {}) {
    const providerData = credentials?.providerSpecificData || {};
    const accountProxies = Array.isArray(providerData.accountProxies) ? providerData.accountProxies : [];

    state.proxyUrlMap.clear();
    for (const entry of accountProxies) {
      const mapped = proxyConfigToUrl(entry);
      if (mapped) state.proxyUrlMap.set(mapped.fingerprint, mapped.url);
    }

    const configuredFingerprints = Array.isArray(providerData.fingerprints)
      ? providerData.fingerprints.filter((fingerprint) => typeof fingerprint === "string")
      : [];

    if (configuredFingerprints.length === 0) {
      // No stored fingerprints: keep the default account and only update proxy metadata.
      for (const account of state.accounts) {
        account.proxy = findAccountProxy(account.fingerprint, accountProxies);
      }
      return;
    }

    // Rebuild the account list from the current credentials so stale or default
    // fingerprints are dropped when the connection changes. Preserve state for
    // fingerprints that are still configured to avoid unnecessary re-bootstraps.
    const oldByFingerprint = new Map(state.accounts.map((account) => [account.fingerprint, account]));
    state.accounts = configuredFingerprints.map((fingerprint) => {
      const old = oldByFingerprint.get(fingerprint);
      return old || this.buildAccount(fingerprint);
    });

    for (const account of state.accounts) {
      account.proxy = findAccountProxy(account.fingerprint, accountProxies);
    }
  }

  async _getJwtForAccount(state, account, signal, proxyOptions = null) {
    if (isAccountReady(account)) return account.jwt;
    const result = await bootstrapJwt(this.baseUrl, account.fingerprint, signal, this._getProxyDispatcher(state, account.fingerprint), proxyOptions);
    account.jwt = result.jwt;
    account.expiresAt = result.expiresAt;
    return account.jwt;
  }

  _pickAccount(state) {
    for (let i = 0; i < state.accounts.length; i++) {
      const idx = (state.nextAccountIdx + i) % state.accounts.length;
      const account = state.accounts[idx];
      if (account.cooldownUntil <= Date.now()) {
        state.nextAccountIdx = (idx + 1) % state.accounts.length;
        return account;
      }
    }
    return null;
  }

  _markCooldown(state, account) {
    account.consecutiveFails += 1;
    const backoff = Math.min(COOLDOWN_BASE_MS * 2 ** (account.consecutiveFails - 1), COOLDOWN_MAX_MS);
    account.cooldownUntil = Date.now() + backoff + Math.random() * 1000;
  }

  _markSuccess(state, account) {
    account.consecutiveFails = 0;
  }

  buildUrl() {
    return `${this.baseUrl.replace(/\/$/, "")}${CHAT_PATH}`;
  }

  buildHeaders(_credentials = {}, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      "X-Mimo-Source": MIMO_SOURCE,
      "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
    };
    if (stream) headers.Accept = "text/event-stream, application/json";
    return headers;
  }

  transformRequest(model, body) {
    if (!body || typeof body !== "object") return body;
    return injectMimocodeSystemMarker({ ...body, model: rewriteModelName(model) });
  }

  async fetchWithTimeout(state, url, init, fingerprint, proxyOptions, signal) {
    const controller = new AbortController();
    if (signal?.aborted) {
      controller.abort(signal.reason);
    }
    const timer = setTimeout(
      () => controller.abort(new Error(`Mimocode chat request timed out after ${CHAT_TIMEOUT_MS}ms`)),
      CHAT_TIMEOUT_MS
    );
    let onSignalAbort;
    if (signal) {
      onSignalAbort = () => controller.abort(signal.reason);
      signal.addEventListener("abort", onSignalAbort, { once: true });
    }
    try {
      return await this._fetchWithProxy(state, url, { ...init, signal: controller.signal }, fingerprint, proxyOptions);
    } finally {
      clearTimeout(timer);
      if (signal && onSignalAbort) signal.removeEventListener("abort", onSignalAbort);
    }
  }

    async testConnection(credentials = {}, signal = null, log = null, proxyOptions = null) {
    try {
      const state = this.getState(credentials);
      this._syncAccountsFromCredentials(state, credentials);
      const account = state.accounts[0];
      const jwt = await this._getJwtForAccount(state, account, signal, proxyOptions);
      const response = await this._fetchWithProxy(
        state,
        this.buildUrl(),
        {
          method: "POST",
          headers: { ...this.buildHeaders(credentials, false), Authorization: `Bearer ${jwt}` },
          body: JSON.stringify(injectMimocodeSystemMarker({
            model: "mimo-auto",
            messages: [{ role: "user", content: "ping" }],
            stream: false,
          })),
          signal: signal ?? undefined,
        },
        account.fingerprint,
        proxyOptions
      );
      return response.status === 200;
    } catch {
      log?.warn?.("MIMOCODE", "testConnection network error");
      return false;
    }
  }

  async execute(input) {
    const { model, stream, body, signal, log, credentials = {}, proxyOptions = null } = input;
    const url = this.buildUrl(model, stream);
    const transformedBody = this.transformRequest(model, body, stream, credentials);

    if (signal?.aborted) {
      return {
        response: new Response(JSON.stringify({ error: { message: "Request aborted", type: "abort", code: "ABORTED" } }), {
          status: 499,
          headers: { "Content-Type": "application/json" },
        }),
        url,
        headers: this.buildHeaders(credentials, stream),
        transformedBody,
      };
    }

    this.syncAccountsFromCredentials(credentials);
    const state = this.getState(credentials);
    let lastError;
    let lastTerminalStatus = 0;
    for (let attempt = 0; attempt < state.accounts.length; attempt++) {
      const account = this._pickAccount(state);
      if (!account) {
        break;
      }
      try {
        const jwt = await this._getJwtForAccount(state, account, signal, proxyOptions);
        const headers = { ...this.buildHeaders(credentials, stream), Authorization: `Bearer ${jwt}` };
        let response = await this.fetchWithTimeout(
          state,
          url,
          { method: "POST", headers, body: JSON.stringify(transformedBody) },
          account.fingerprint,
          proxyOptions,
          signal
        );

        async function drainBody(r) {
          if (r?.body?.cancel) {
            try { await r.body.cancel(); } catch {}
          } else if (r?.body?.getReader) {
            try {
              const reader = r.body.getReader();
              while (!(await reader.read()).done) {}
            } catch {}
          }
        }

        if (response.status === 401 || response.status === 403) {
          log?.warn?.("MIMOCODE", `Auth failed (${response.status}) on account ${account.fingerprint.slice(0, 8)}`);
          await drainBody(response);
          account.jwt = "";
          account.expiresAt = 0;
          account.consecutiveFails = 0;
          headers.Authorization = `Bearer ${await this._getJwtForAccount(state, account, signal, proxyOptions)}`;
          response = await this.fetchWithTimeout(
            state,
            url,
            { method: "POST", headers, body: JSON.stringify(transformedBody) },
            account.fingerprint,
            proxyOptions,
            signal
          );
          if (response.status === 401 || response.status === 403) {
            await drainBody(response);
            this._markCooldown(state, account);
            lastTerminalStatus = response.status;
            log?.warn?.("MIMOCODE", `Account ${account.fingerprint.slice(0, 8)} still unauthorized after refresh; rotating`);
            continue;
          }
        }

        if (response.status === 429) {
          await drainBody(response);
          this._markCooldown(state, account);
          lastTerminalStatus = response.status;
          log?.warn?.("MIMOCODE", `Rate limited on account ${account.fingerprint.slice(0, 8)}, trying next`);
          continue;
        }

        if ([502, 503, 504].includes(response.status)) {
          await drainBody(response);
          this._markCooldown(state, account);
          lastTerminalStatus = response.status;
          log?.warn?.("MIMOCODE", `Retryable HTTP ${response.status} on account ${account.fingerprint.slice(0, 8)}, rotating`);
          continue;
        }

        this._markSuccess(state, account);
        return { response, url, headers, transformedBody };
      } catch (error) {
        if (signal?.aborted && isAbortError(error)) {
          throw error;
        }
        lastError = error;
        this._markCooldown(state, account);
        const terminalStatus = error?.status || 0;
        if (terminalStatus) lastTerminalStatus = terminalStatus;
        if (attempt === state.accounts.length - 1) {
          const message = error instanceof Error ? error.message : String(error);
          log?.error?.("MIMOCODE", `Executor error: ${message}`);
          const terminalStatus = lastTerminalStatus || error?.status || 502;
          return {
            response: new Response(JSON.stringify({ error: { message, type: "upstream_error", code: "EXECUTOR_ERROR" } }), {
              status: terminalStatus,
              headers: { "Content-Type": "application/json" },
            }),
            url,
            headers: this.buildHeaders(credentials, stream),
            transformedBody,
          };
        }
      }
    }

    const terminalStatus = lastTerminalStatus || 502;
    const message = lastError instanceof Error ? lastError.message : (terminalStatus === 429 ? "All accounts rate limited" : "All accounts exhausted");
    return {
      response: new Response(JSON.stringify({ error: { message, type: "upstream_error", code: "NO_ACCOUNTS" } }), {
        status: terminalStatus,
        headers: { "Content-Type": "application/json" },
      }),
      url,
      headers: this.buildHeaders(credentials, stream),
      transformedBody,
    };
  }
}

export const __test__ = {
  BASE_URL,
  BOOTSTRAP_PATH,
  CHAT_PATH,
  MIMO_SOURCE,
  bootstrapJwt,
  bootstrapInflight,
  dispatcherCache,
  injectMimocodeSystemMarker,
  proxyConfigToUrl,
};

export default MimocodeExecutor;
