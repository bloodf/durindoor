import crypto from "node:crypto";
import os from "node:os";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { BaseExecutor } from "./base.js";

const BASE_URL = "https://api.xiaomimimo.com";
const BOOTSTRAP_PATH = "/api/free-ai/bootstrap";
const CHAT_PATH = "/api/free-ai/openai/chat";
const JWT_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const BOOTSTRAP_TIMEOUT_MS = 15_000;
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

function proxyConfigToUrl(entry) {
  const proxy = entry?.proxy;
  if (!entry?.fingerprint || !proxy?.host) return null;
  const type = proxy.type || "socks5";
  if (type !== "http" && type !== "https") {
    throw new Error(`Mimocode per-account proxy type "${type}" is not supported in this DurinDoor port; use http/https or add a fetch-socks dispatcher.`);
  }
  const port = proxy.port ?? (type === "https" ? 443 : 8080);
  const auth = proxy.username
    ? `${encodeURIComponent(proxy.username)}:${proxy.password ? encodeURIComponent(proxy.password) : ""}@`
    : "";
  return { fingerprint: entry.fingerprint, url: `${type}://${auth}${proxy.host}:${port}` };
}

async function bootstrapJwt(baseUrl, fingerprint, signal, dispatcher) {
  const existing = bootstrapInflight.get(fingerprint);
  if (existing) return existing;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BOOTSTRAP_TIMEOUT_MS);
  const onSignal = signal ? () => controller.abort(signal.reason) : null;
  if (signal && onSignal) signal.addEventListener("abort", onSignal, { once: true });

  const promise = (async () => {
    try {
      const url = `${baseUrl.replace(/\/$/, "")}${BOOTSTRAP_PATH}`;
      const init = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: fingerprint }),
        signal: controller.signal,
      };
      const response = dispatcher
        ? await undiciFetch(url, { ...init, dispatcher })
        : await fetch(url, init);
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Bootstrap failed: ${response.status} ${text.slice(0, 200)}`);
      }
      const data = await response.json();
      if (!data?.jwt) throw new Error("Bootstrap response missing jwt field");
      return { jwt: data.jwt, expiresAt: parseJwtExp(data.jwt) };
    } finally {
      clearTimeout(timer);
      if (signal && onSignal) signal.removeEventListener("abort", onSignal);
      bootstrapInflight.delete(fingerprint);
    }
  })();

  bootstrapInflight.set(fingerprint, promise);
  return promise;
}

export class MimocodeExecutor extends BaseExecutor {
  constructor() {
    super("mimocode", { format: "openai", noAuth: true, baseUrl: BASE_URL });
    this.baseUrl = BASE_URL;
    this.accounts = [this.buildAccount(generateFingerprint())];
    this.nextAccountIdx = 0;
    this.proxyUrlMap = new Map();
  }

  buildAccount(fingerprint) {
    return { fingerprint, jwt: "", expiresAt: 0, cooldownUntil: 0, consecutiveFails: 0, proxy: null };
  }

  getProxyDispatcher(fingerprint) {
    return createDispatcher(this.proxyUrlMap.get(fingerprint));
  }

  fetchWithProxy(url, init, fingerprint) {
    const dispatcher = this.getProxyDispatcher(fingerprint);
    if (dispatcher) return undiciFetch(url, { ...init, dispatcher });
    return fetch(url, init);
  }

  syncAccountsFromCredentials(credentials = {}) {
    const providerData = credentials?.providerSpecificData || {};
    const accountProxies = Array.isArray(providerData.accountProxies) ? providerData.accountProxies : [];
    this.proxyUrlMap.clear();
    for (const entry of accountProxies) {
      const mapped = proxyConfigToUrl(entry);
      if (mapped) this.proxyUrlMap.set(mapped.fingerprint, mapped.url);
    }

    const existing = new Set(this.accounts.map((account) => account.fingerprint));
    if (Array.isArray(providerData.fingerprints)) {
      for (const fingerprint of providerData.fingerprints) {
        if (typeof fingerprint === "string" && !existing.has(fingerprint)) {
          this.accounts.push(this.buildAccount(fingerprint));
          existing.add(fingerprint);
        }
      }
    }

    const structuredProxyMap = new Map(accountProxies.map((entry) => [entry.fingerprint, entry.proxy ?? null]));
    for (const account of this.accounts) {
      account.proxy = structuredProxyMap.has(account.fingerprint)
        ? structuredProxyMap.get(account.fingerprint)
        : null;
    }
  }

  async getJwtForAccount(account, signal) {
    if (isAccountReady(account)) return account.jwt;
    const result = await bootstrapJwt(this.baseUrl, account.fingerprint, signal, this.getProxyDispatcher(account.fingerprint));
    account.jwt = result.jwt;
    account.expiresAt = result.expiresAt;
    return account.jwt;
  }

  pickAccount() {
    for (let i = 0; i < this.accounts.length; i++) {
      const idx = (this.nextAccountIdx + i) % this.accounts.length;
      const account = this.accounts[idx];
      if (isAccountReady(account)) {
        this.nextAccountIdx = (idx + 1) % this.accounts.length;
        return account;
      }
    }
    const fallbackIdx = this.nextAccountIdx % this.accounts.length;
    this.nextAccountIdx = (this.nextAccountIdx + 1) % this.accounts.length;
    return this.accounts[fallbackIdx];
  }

  markCooldown(account) {
    account.consecutiveFails += 1;
    const backoff = Math.min(COOLDOWN_BASE_MS * 2 ** (account.consecutiveFails - 1), COOLDOWN_MAX_MS);
    account.cooldownUntil = Date.now() + backoff + Math.random() * 1000;
  }

  markSuccess(account) {
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

  async testConnection(credentials = {}, signal = null, log = null) {
    try {
      this.syncAccountsFromCredentials(credentials);
      const account = this.accounts[0];
      const jwt = await this.getJwtForAccount(account, signal);
      const response = await this.fetchWithProxy(
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
        account.fingerprint
      );
      return response.status === 200;
    } catch {
      log?.warn?.("MIMOCODE", "testConnection network error");
      return false;
    }
  }

  async execute(input) {
    const { model, stream, body, signal, log, credentials = {}, requestContext = null } = input;
    const url = this.buildUrl(model, stream);
    const transformedBody = this.clampCustomMaxOutput(
      this.transformRequest(model, body, stream, credentials),
      requestContext,
    );

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
    for (let attempt = 0; attempt < this.accounts.length; attempt++) {
      const account = this.pickAccount();
      try {
        const jwt = await this.getJwtForAccount(account, signal);
        const headers = { ...this.buildHeaders(credentials, stream), Authorization: `Bearer ${jwt}` };
        let response = await this.fetchWithProxy(
          url,
          { method: "POST", headers, body: JSON.stringify(transformedBody), signal: signal ?? undefined },
          account.fingerprint
        );

        if (response.status === 401 || response.status === 403) {
          log?.warn?.("MIMOCODE", `Auth failed (${response.status}) on account ${account.fingerprint.slice(0, 8)}`);
          account.jwt = "";
          account.expiresAt = 0;
          account.consecutiveFails = 0;
          headers.Authorization = `Bearer ${await this.getJwtForAccount(account, signal)}`;
          response = await this.fetchWithProxy(
            url,
            { method: "POST", headers, body: JSON.stringify(transformedBody), signal: signal ?? undefined },
            account.fingerprint
          );
        }

        if (response.status === 429) {
          this.markCooldown(account);
          log?.warn?.("MIMOCODE", `Rate limited on account ${account.fingerprint.slice(0, 8)}, trying next`);
          continue;
        }

        this.markSuccess(account);
        return { response, url, headers, transformedBody };
      } catch (error) {
        this.markCooldown(account);
        if (attempt === this.accounts.length - 1) {
          const message = error instanceof Error ? error.message : String(error);
          log?.error?.("MIMOCODE", `Executor error: ${message}`);
          return {
            response: new Response(JSON.stringify({ error: { message, type: "upstream_error", code: "EXECUTOR_ERROR" } }), {
              status: 502,
              headers: { "Content-Type": "application/json" },
            }),
            url,
            headers: this.buildHeaders(credentials, stream),
            transformedBody,
          };
        }
      }
    }

    return {
      response: new Response(JSON.stringify({
        error: { message: "All accounts exhausted", type: "upstream_error", code: "NO_ACCOUNTS" },
      }), { status: 502, headers: { "Content-Type": "application/json" } }),
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
