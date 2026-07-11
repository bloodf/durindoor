// Quota auto-ping scheduler: warms 5h windows by sending tiny opt-in requests right after reset.
import "open-sse/index.js";

import { getSettings, getProviderConnections, updateProviderConnection } from "@/lib/localDb";
import { getClaudeUsage } from "open-sse/services/usage/claude.js";
import { getCodexUsage } from "open-sse/services/usage/codex.js";
import { getExecutor } from "open-sse/executors/index.js";
import { CLAUDE_CLI_SPOOF_HEADERS } from "open-sse/providers/shared.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "@/shared/services/providerCredentials";
import { QUOTA_AUTOPING_CONFIG } from "@/shared/constants/config";

const C = QUOTA_AUTOPING_CONFIG;
const CLAUDE_PING_URL = "https://api.anthropic.com/v1/messages?beta=true";

const providerHandlers = {
  claude: {
    getUsage: getClaudeUsage,
    sendPing: sendClaudePing,
  },
  codex: {
    getUsage: (accessToken, proxyOptions, connection) =>
      getCodexUsage(accessToken, connection?.providerSpecificData, proxyOptions),
    sendPing: sendCodexPing,
  },
};

// Survive Next.js hot reload and keep one scheduler per server process.
const g = (global.__quotaAutoPing ??= {
  interval: null,
  running: false,
  resetCache: {},
  failureCache: {},
  inflightControllers: {},
  rerunRequested: false,
});

function cacheKey(provider, connectionId) {
  return `${provider}:${connectionId}`;
}

function normalizeResetKey(resetAt) {
  const ms = new Date(resetAt).getTime();
  if (!Number.isFinite(ms)) return resetAt;
  return new Date(Math.floor(ms / 60000) * 60000).toISOString();
}

function getResetDriftMs(previousResetAt, nextResetAt) {
  const previousMs = new Date(previousResetAt).getTime();
  const nextMs = new Date(nextResetAt).getTime();
  if (!Number.isFinite(previousMs) || !Number.isFinite(nextMs)) return 0;
  return nextMs - previousMs;
}

function toFiniteNumber(value, fallback = null) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function isQuotaExhausted(quota) {
  if (!quota || quota.unlimited === true) return false;
  const remaining = toFiniteNumber(quota.remaining);
  if (remaining !== null) return remaining <= 0;

  const used = toFiniteNumber(quota.used);
  const total = toFiniteNumber(quota.total);
  return total !== null && total > 0 && used !== null && used >= total;
}

function wasPingedRecently(connection, intervalMs, nowMs = Date.now()) {
  if (!intervalMs) return false;
  const lastPingAtMs = new Date(connection.lastPingAt).getTime();
  return Number.isFinite(lastPingAtMs) && nowMs - lastPingAtMs < intervalMs;
}

function isBlockingQuotaName(name, sessionKey) {
  if (name === sessionKey) return false;
  return !String(name).toLowerCase().includes("session");
}

function hasExhaustedBlockingQuota(quotas, sessionKey) {
  return Object.entries(quotas || {}).some(([name, quota]) => isBlockingQuotaName(name, sessionKey) && isQuotaExhausted(quota));
}

function shouldPingForReset(providerConfig, cachedReset, resetAt, now) {
  if (providerConfig.pingWhenResetAtSlides) {
    return Boolean(cachedReset) && getResetDriftMs(cachedReset, resetAt) >= (providerConfig.resetAtDriftMs || 0);
  }

  const resetMs = new Date(resetAt).getTime();
  return Number.isFinite(resetMs) && now >= resetMs - C.pingLeadMs;
}

function buildProxyOptions(cfg) {
  return {
    connectionProxyEnabled: cfg.connectionProxyEnabled === true,
    connectionProxyUrl: cfg.connectionProxyUrl || "",
    connectionNoProxy: cfg.connectionNoProxy || "",
    vercelRelayUrl: cfg.vercelRelayUrl || "",
    strictProxy: cfg.strictProxy === true,
    disableEnvProxy: cfg.disableEnvProxy === true,
  };
}

async function sendClaudePing(connection, providerConfig, proxyOptions, deps, signal) {
  const res = await deps.proxyAwareFetch(CLAUDE_PING_URL, {
    method: "POST",
    headers: {
      ...CLAUDE_CLI_SPOOF_HEADERS,
      "Authorization": `Bearer ${connection.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: providerConfig.pingModel,
      max_tokens: providerConfig.pingMaxTokens,
      messages: [{ role: "user", content: providerConfig.pingText }],
    }),
    signal,
  }, proxyOptions);
  if (!res.ok) {
    await cancelResponseBody(res, signal);
    return false;
  }
  await drainResponseBody(res, signal);
  return true;
}

function buildCodexPingInput(text) {
  return [{
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
  }];
}

async function drainResponseBody(response, signal) {
  const reader = response?.body?.getReader?.();
  if (!reader) {
    if (typeof response?.text === "function") {
      await awaitWithSignal(response.text(), signal);
    }
    return;
  }

  try {
    while (true) {
      const { done } = await awaitWithSignal(reader.read(), signal);
      if (done) return;
    }
  } catch (error) {
    if (signal?.aborted) {
      try { await reader.cancel?.(signal.reason); } catch { /* noop */ }
    }
    throw error;
  } finally {
    reader.releaseLock?.();
  }
}

async function cancelResponseBody(response, signal) {
  const cancel = response?.body?.cancel;
  if (typeof cancel !== "function") return;
  await awaitWithSignal(cancel.call(response.body, signal?.reason), signal);
}

async function sendCodexPing(connection, providerConfig, proxyOptions, deps, signal) {
  const executor = deps.getExecutor("codex");
  const { response } = await executor.execute({
    model: providerConfig.pingModel,
    stream: true,
    credentials: {
      accessToken: connection.accessToken,
      connectionId: connection.id,
      providerSpecificData: connection.providerSpecificData,
    },
    proxyOptions,
    signal,
    log: console,
    body: {
      model: providerConfig.pingModel,
      input: buildCodexPingInput(providerConfig.pingText),
      instructions: providerConfig.pingInstructions,
      reasoning: providerConfig.pingReasoningEffort
        ? { effort: providerConfig.pingReasoningEffort, summary: "auto" }
        : undefined,
      store: false,
      stream: true,
    },
  });
  if (!response.ok) {
    try { await cancelResponseBody(response, signal); } catch { /* noop */ }
    return false;
  }

  // Codex only starts the 5h window after the streaming response completes.
  await drainResponseBody(response, signal);
  return true;
}

function shouldSkipAfterFailure(state, key, nowMs = Date.now()) {
  const failedAt = state.failureCache[key];
  return failedAt && nowMs - failedAt < C.failureCooldownMs;
}

async function pingConnectionCore(conn, provider, providerConfig, handler, deps, state, signal) {
  const key = cacheKey(provider, conn.id);

  // resetAt is stable for time-based windows; Codex polls every tick because inactive windows slide forward.
  const cachedReset = state.resetCache[key];
  if (!providerConfig.pingWhenResetAtSlides && cachedReset && Date.now() < new Date(cachedReset).getTime() - C.refreshAheadMs) return;

  // Avoid hammering provider auth/quota endpoints if a ping failed recently.
  if (shouldSkipAfterFailure(state, key)) return;

  const proxyCfg = await deps.resolveConnectionProxyConfig(conn.providerSpecificData);
  signal.throwIfAborted();
  const proxyOptions = buildProxyOptions(proxyCfg);

  let connection = conn;
  try {
    const r = await deps.refreshAndUpdateCredentials(connection, false, proxyOptions);
    signal.throwIfAborted();
    connection = r.connection;
  } catch (e) {
    if (signal.aborted || e?.name === "AbortError") throw signal.reason || e;
    state.failureCache[key] = Date.now();
    console.warn(`[AutoPing] ${provider}:${conn.id}: credential refresh failed`);
    return;
  }

  const usage = await handler.getUsage(connection.accessToken, proxyOptions, connection);
  signal.throwIfAborted();
  const quotas = usage?.quotas || {};
  const quota = quotas?.[providerConfig.quotaKey];
  const resetAt = quota?.resetAt;
  if (!resetAt) return;

  state.resetCache[key] = resetAt;

  if (providerConfig.skipWhenBlockingQuotaExhausted && hasExhaustedBlockingQuota(quotas, providerConfig.quotaKey)) return;
  if (isQuotaExhausted(quota)) return;

  const now = Date.now();
  const resetKey = normalizeResetKey(resetAt);
  const lastPingedResetKey = connection.lastPingedResetKey || normalizeResetKey(connection.lastPingedResetAt);

  // Claude waits for reset. Codex pings only when resetAt slides, which means the 5h window is inactive.
  if (!shouldPingForReset(providerConfig, cachedReset, resetAt, now)) return;
  if (wasPingedRecently(connection, providerConfig.minPingIntervalMs, now)) return;
  if (lastPingedResetKey === resetKey) return;

  // Settings and connection rows can change while quota/credential lookups are
  // in flight. Revalidate immediately before the paid outbound request.
  const latestSettings = await deps.getSettings();
  signal.throwIfAborted();
  const latestConnections = await deps.getProviderConnections({ provider, isActive: true });
  signal.throwIfAborted();
  const latestConnection = latestConnections.find((candidate) => candidate.id === connection.id);
  if (latestSettings?.[providerConfig.settingsKey]?.connections?.[connection.id] !== true
    || latestConnection?.authType !== "oauth") return;

  const ok = await handler.sendPing(latestConnection, providerConfig, proxyOptions, deps, signal);
  signal.throwIfAborted();
  if (!ok) {
    // Do not mark reset as pinged unless upstream accepted the tiny request.
    state.failureCache[key] = Date.now();
    console.warn(`[AutoPing] ${provider}:${connection.id}: ping failed (reset ${resetAt})`);
    return;
  }

  delete state.failureCache[key];
  signal.throwIfAborted();
  await deps.updateProviderConnection(connection.id, {
    lastPingedResetAt: resetAt,
    lastPingedResetKey: resetKey,
    lastPingAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  console.log(`[AutoPing] ${provider}:${connection.id}: ping sent (reset ${resetAt})`);
}

function awaitWithSignal(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason || new Error("Auto-ping aborted"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason || new Error("Auto-ping aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

async function pingConnection(conn, provider, providerConfig, handler, deps, state = g) {
  const key = cacheKey(provider, conn.id);
  const controller = new AbortController();
  const timeoutSignal = AbortSignal.timeout(C.pingTimeoutMs || 45000);
  const signal = AbortSignal.any([controller.signal, timeoutSignal]);
  state.inflightControllers ||= {};
  state.inflightControllers[key]?.abort(new DOMException("Superseded auto-ping attempt", "AbortError"));
  state.inflightControllers[key] = controller;
  try {
    return await awaitWithSignal(
      pingConnectionCore(conn, provider, providerConfig, handler, deps, state, signal),
      signal,
    );
  } finally {
    if (state.inflightControllers[key] === controller) delete state.inflightControllers[key];
  }
}

function createDefaultDeps() {
  return {
    getSettings,
    getProviderConnections,
    updateProviderConnection,
    resolveConnectionProxyConfig,
    refreshAndUpdateCredentials,
    proxyAwareFetch,
    getExecutor,
  };
}

export async function runQuotaAutoPingTick(deps = createDefaultDeps(), state = g) {
  if (state.running) {
    state.rerunRequested = true;
    return;
  }
  state.running = true;
  try {
    const settings = await deps.getSettings();

    for (const [provider, providerConfig] of Object.entries(C.providers)) {
      const handler = providerHandlers[provider];
      if (!handler) continue;

      const enabledMap = settings?.[providerConfig.settingsKey]?.connections || {};
      if (Object.keys(enabledMap).length === 0) continue;

      const conns = await deps.getProviderConnections({ provider, isActive: true });
      const targets = conns.filter((conn) => conn.authType === "oauth" && enabledMap[conn.id] === true);
      for (const conn of targets) {
        try {
          await pingConnection(conn, provider, providerConfig, handler, deps, state);
        } catch (e) {
          if (e?.name !== "AbortError") state.failureCache[cacheKey(provider, conn.id)] = Date.now();
          console.warn(`[AutoPing] ${provider}:${conn.id}: provider ping failed`);
        }
      }
    }
  } catch (e) {
    console.warn("[AutoPing] scheduler tick failed");
  } finally {
    state.running = false;
    if (state.rerunRequested) {
      state.rerunRequested = false;
      queueMicrotask(() => { runQuotaAutoPingTick(deps, state).catch(() => {}); });
    }
  }
}

export function notifyQuotaAutoPingSettingChanged(provider, connectionId, enabled, state = g) {
  const key = cacheKey(provider, connectionId);
  state.inflightControllers ||= {};
  state.resetCache ||= {};
  state.failureCache ||= {};
  if (enabled !== true) {
    state.inflightControllers[key]?.abort(new DOMException("Auto-ping disabled", "AbortError"));
  }
  delete state.resetCache[key];
  delete state.failureCache[key];
  if (enabled === true) runQuotaAutoPingTick().catch(() => {});
}

export function startQuotaAutoPing() {
  if (g.interval) return;
  console.log("[AutoPing] scheduler started");
  runQuotaAutoPingTick().catch(() => {});
  g.interval = setInterval(() => { runQuotaAutoPingTick().catch(() => {}); }, C.tickIntervalMs);
  if (g.interval.unref) g.interval.unref();
}
