// Quota auto-ping scheduler: warms 5h windows by sending tiny opt-in requests right after reset.
import "open-sse/index.js";

import {
  getSettings,
  getProviderConnections,
  updateProviderConnection,
  listProviderQuotaSnapshots,
  getQuotaFetchState,
} from "@/lib/localDb";
import { getExecutor } from "open-sse/executors/index.js";
import { CLAUDE_CLI_SPOOF_HEADERS } from "open-sse/providers/shared.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "@/shared/services/providerCredentials";
import { refreshProviderQuota } from "@/shared/services/providerQuotaTracker";
import { rotationGroupFor } from "open-sse/services/refreshSerializer.js";
import {
  buildQuotaResourceKeys,
  evaluateProviderQuotaPreflight,
  inspectProviderQuota,
} from "@/shared/services/providerQuotaPreflight";
import { QUOTA_AUTOPING_CONFIG } from "@/shared/constants/config";
import { readBoundedResponseText } from "open-sse/utils/error.js";
import { createUpstreamTerminalTracker } from "open-sse/utils/streamTerminal.js";
import { FORMATS } from "open-sse/translator/formats.js";

const C = QUOTA_AUTOPING_CONFIG;
const CLAUDE_PING_URL = "https://api.anthropic.com/v1/messages?beta=true";

const providerHandlers = {
  claude: { sendPing: sendClaudePing },
  codex: { sendPing: sendCodexPing },
};

// Survive Next.js hot reload and keep one scheduler per server process.
const g = (global.__quotaAutoPing ??= {
  interval: null,
  running: false,
  pingFailureUntil: {},
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

function wasPingedRecently(connection, intervalMs, nowMs = Date.now()) {
  if (!intervalMs) return false;
  const lastPingAtMs = new Date(connection.lastPingAt).getTime();
  return Number.isFinite(lastPingAtMs) && nowMs - lastPingAtMs < intervalMs;
}

function isFreshSnapshot(snapshot, now = Date.now()) {
  const observedAt = Date.parse(snapshot?.timing?.observedAt || "");
  const staleAt = Date.parse(snapshot?.timing?.staleAt || "");
  return Number.isFinite(observedAt) && observedAt <= now && Number.isFinite(staleAt) && staleAt > now;
}

function sessionSnapshot(snapshots, connectionId) {
  return (snapshots || [])
    .filter((snapshot) => (
      snapshot?.identity?.connectionId === connectionId
      && snapshot?.identity?.resourceKey === "scope:account"
      && snapshot?.identity?.dimensionKey === "requests:session"
    ))
    .sort((a, b) => Date.parse(b.timing.observedAt) - Date.parse(a.timing.observedAt))[0] || null;
}

function hasBlockingLongWindow(snapshots, connectionId, provider, model, now) {
  const nonSession = (snapshots || []).filter(
    (snapshot) => snapshot?.identity?.dimensionKey !== "requests:session",
  );
  return evaluateProviderQuotaPreflight(nonSession, {
    connectionId,
    provider,
    resourceKeys: buildQuotaResourceKeys({ provider, modelCandidates: [model] }),
    now,
  }).skip;
}

function prunePingFailures(state, now = Date.now()) {
  state.pingFailureUntil ||= {};
  for (const [key, deadline] of Object.entries(state.pingFailureUntil)) {
    if (!Number.isFinite(deadline) || deadline <= now) delete state.pingFailureUntil[key];
  }
  const entries = Object.entries(state.pingFailureUntil).sort((left, right) => left[1] - right[1]);
  while (entries.length > 512) {
    const [key] = entries.shift();
    delete state.pingFailureUntil[key];
  }
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
      "accept": "text/event-stream",
    },
    body: JSON.stringify({
      model: providerConfig.pingModel,
      max_tokens: providerConfig.pingMaxTokens,
      messages: [{ role: "user", content: providerConfig.pingText }],
      stream: true,
    }),
    signal,
  }, proxyOptions);
  if (!res.ok) {
    await cancelResponseBody(res, signal);
    return false;
  }
  return validatePingTerminal(res, FORMATS.CLAUDE, signal);
}

function buildCodexPingInput(text) {
  return [{
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
  }];
}

async function validatePingTerminal(response, format, signal) {
  const text = await readBoundedResponseText(response, {
    signal,
    maxBytes: 64 * 1024,
    timeoutMs: Math.min(C.pingTimeoutMs || 45_000, 10_000),
  });
  if (!text.trim()) return false;

  const terminal = createUpstreamTerminalTracker({ format });
  let eventName = null;
  let sawData = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":")) continue;
    if (trimmed.startsWith("event:")) {
      eventName = trimmed.slice(6).trim() || null;
      continue;
    }
    if (!trimmed.startsWith("data:")) continue;
    sawData = true;
    const payload = trimmed.slice(5).trim();
    if (!payload) return false;
    if (payload === "[DONE]") {
      terminal.observe({ rawDone: true, eventName });
      eventName = null;
      continue;
    }
    let chunk;
    try { chunk = JSON.parse(payload); }
    catch { return false; }
    terminal.observe({ chunk, eventName });
    eventName = null;
  }

  if (!sawData) {
    try {
      const chunk = JSON.parse(text);
      terminal.observe({ chunk, eventName: chunk?.type || null });
    } catch {
      return false;
    }
  }
  return terminal.outcome === "success";
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
      idToken: connection.idToken,
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
  return validatePingTerminal(response, FORMATS.OPENAI_RESPONSES, signal);
}

function shouldSkipAfterFailure(state, key, nowMs = Date.now()) {
  const retryAt = state.pingFailureUntil?.[key];
  return Number.isFinite(retryAt) && retryAt > nowMs;
}

async function pingConnectionCore(conn, provider, providerConfig, handler, deps, state, signal) {
  const key = cacheKey(provider, conn.id);
  state.pingFailureUntil ||= {};
  prunePingFailures(state);
  // The breaker protects only the optional paid ping path. Provider-quota fetch
  // throttling and failure state belong to the Batch-2 tracker/repository.
  if (shouldSkipAfterFailure(state, key)) return;

  const nowBeforeRefresh = Date.now();
  let priorSnapshots;
  try {
    priorSnapshots = await deps.listProviderQuotaSnapshots({
      connectionId: conn.id,
      provider,
      includeStale: true,
      now: nowBeforeRefresh,
    });
  } catch {
    console.warn(`[AutoPing] ${provider}:${conn.id}: quota state read failed`);
    return;
  }
  signal.throwIfAborted();
  const priorSession = sessionSnapshot(priorSnapshots, conn.id);
  const priorResetAt = priorSession?.timing?.resetAt || null;
  const preflight = await inspectProviderQuota([conn], {
    provider,
    resourceKeys: buildQuotaResourceKeys({ provider, modelCandidates: [providerConfig.pingModel] }),
    now: nowBeforeRefresh,
    snapshotsLoader: async () => priorSnapshots,
    fetchStateLoader: deps.getQuotaFetchState
      ? (query) => deps.getQuotaFetchState(query, { now: nowBeforeRefresh })
      : async () => null,
  });
  const priorDecision = preflight.get(conn.id);
  if (priorDecision?.reason === "tracker_error" && priorDecision.shouldRefresh === false) return;
  // Time-based windows do not need another upstream read until close to reset.
  // Codex is intentionally refreshed each tick because an inactive 5h window
  // slides forward and that drift is the signal to ping.
  if (
    !providerConfig.pingWhenResetAtSlides
    && priorResetAt
    && nowBeforeRefresh < Date.parse(priorResetAt) - C.refreshAheadMs
  ) return;

  let refreshedQuota;
  try {
    refreshedQuota = await deps.refreshProviderQuota(conn, { signal, force: true });
    signal.throwIfAborted();
  } catch (e) {
    if (signal.aborted || e?.name === "AbortError") throw signal.reason || e;
    console.warn(`[AutoPing] ${provider}:${conn.id}: quota refresh failed`);
    return;
  }
  if (!["success", "superseded"].includes(refreshedQuota?.outcome)) return;
  let snapshots;
  try {
    // Always reload the repository so response-header/runtime sources remain
    // visible beside the freshly replaced provider-API source.
    snapshots = await deps.listProviderQuotaSnapshots({
      connectionId: conn.id,
      provider,
      includeStale: true,
      now: Date.now(),
    });
  } catch {
    console.warn(`[AutoPing] ${provider}:${conn.id}: quota state read failed`);
    return;
  }
  signal.throwIfAborted();
  const session = sessionSnapshot(snapshots, conn.id);
  const resetAt = session?.timing?.resetAt || null;
  if (providerConfig.pingWhenResetAtSlides && !resetAt) return;

  const now = Date.now();
  if (hasBlockingLongWindow(
    snapshots,
    conn.id,
    provider,
    providerConfig.pingModel,
    now,
  )) return;
  if (!isFreshSnapshot(session, now) || session.state === "exhausted" || session.state === "cooldown") return;

  const triggerResetAt = providerConfig.pingWhenResetAtSlides
    ? resetAt
    : (priorResetAt || resetAt);
  if (!triggerResetAt) return;
  const resetKey = normalizeResetKey(triggerResetAt);
  const lastPingedResetKey = conn.lastPingedResetKey || normalizeResetKey(conn.lastPingedResetAt);

  // Claude waits for reset. Codex pings only when resetAt slides, which means the 5h window is inactive.
  if (!shouldPingForReset(providerConfig, priorResetAt, triggerResetAt, now)) return;
  if (wasPingedRecently(conn, providerConfig.minPingIntervalMs, now)) return;
  if (lastPingedResetKey === resetKey) return;

  // Re-read, refresh through the shared CAS coordinator, and then re-read again
  // immediately before the paid outbound request. This prevents a setting,
  // credential, or proxy-route change during quota lookup from leaking through.
  let latestSettings = await deps.getSettings();
  signal.throwIfAborted();
  let latestConnections = await deps.getProviderConnections({ provider, isActive: true });
  signal.throwIfAborted();
  let latestConnection = latestConnections.find((candidate) => candidate.id === conn.id);
  if (latestSettings?.[providerConfig.settingsKey]?.connections?.[conn.id] !== true
    || latestConnection?.authType !== "oauth") return;

  try {
    const refreshProxy = buildProxyOptions(
      await deps.resolveConnectionProxyConfig(latestConnection.providerSpecificData),
    );
    signal.throwIfAborted();
    // Front 2 (OmniRoute 697946381d): rotating-refresh providers (Codex/OpenAI
    // share one Auth0 client_id) mint a single-use refresh_token on every
    // refresh. The auto-ping sweep refreshes many connections around the same
    // reset boundary; proactively refreshing sibling accounts in parallel makes
    // Auth0 revoke the whole token family (openai/codex#9648) and kills every
    // account but the last. Never proactively refresh them here — reuse the
    // current access_token for the ping and let the reactive, serialized 401
    // path (or the next real request) handle genuine expiry.
    if (rotationGroupFor(latestConnection.provider) === null) {
      const refreshed = await deps.refreshAndUpdateCredentials(
        latestConnection,
        false,
        refreshProxy,
        { signal },
      );
      signal.throwIfAborted();
      latestConnection = refreshed.connection;
    }
  } catch (e) {
    if (signal.aborted || e?.name === "AbortError") throw signal.reason || e;
    state.pingFailureUntil[key] = Date.now() + C.failureCooldownMs;
    console.warn(`[AutoPing] ${provider}:${conn.id}: credential refresh failed`);
    return;
  }

  latestSettings = await deps.getSettings();
  signal.throwIfAborted();
  latestConnections = await deps.getProviderConnections({ provider, isActive: true });
  signal.throwIfAborted();
  latestConnection = latestConnections.find((candidate) => candidate.id === conn.id);
  if (latestSettings?.[providerConfig.settingsKey]?.connections?.[conn.id] !== true
    || latestConnection?.authType !== "oauth") return;
  const proxyOptions = buildProxyOptions(
    await deps.resolveConnectionProxyConfig(latestConnection.providerSpecificData),
  );
  signal.throwIfAborted();

  let finalSnapshots;
  try {
    finalSnapshots = await deps.listProviderQuotaSnapshots({
      connectionId: conn.id,
      provider,
      includeStale: true,
      now: Date.now(),
    });
  } catch {
    console.warn(`[AutoPing] ${provider}:${conn.id}: final quota state read failed`);
    return;
  }
  signal.throwIfAborted();
  const finalSession = sessionSnapshot(finalSnapshots, conn.id);
  const finalResetAt = finalSession?.timing?.resetAt || null;
  const finalNow = Date.now();
  const refreshedObservedAt = Date.parse(session?.timing?.observedAt || "");
  const finalObservedAt = Date.parse(finalSession?.timing?.observedAt || "");
  if (
    !finalSession
    || !isFreshSnapshot(finalSession, finalNow)
    || ["exhausted", "cooldown"].includes(finalSession.state)
    || !Number.isFinite(finalObservedAt)
    || (Number.isFinite(refreshedObservedAt) && finalObservedAt < refreshedObservedAt)
  ) return;
  if (providerConfig.pingWhenResetAtSlides) {
    if (
      !finalResetAt
      || normalizeResetKey(finalResetAt) !== normalizeResetKey(resetAt)
      || !shouldPingForReset(providerConfig, priorResetAt, finalResetAt, finalNow)
    ) return;
  } else if (!shouldPingForReset(providerConfig, priorResetAt, triggerResetAt, finalNow)) return;
  if (hasBlockingLongWindow(
    finalSnapshots,
    conn.id,
    provider,
    providerConfig.pingModel,
    finalNow,
  )) return;

  const ok = await handler.sendPing(latestConnection, providerConfig, proxyOptions, deps, signal);
  signal.throwIfAborted();
  if (!ok) {
    // Do not mark reset as pinged unless upstream accepted the tiny request.
    state.pingFailureUntil[key] = Date.now() + C.failureCooldownMs;
    console.warn(`[AutoPing] ${provider}:${conn.id}: ping failed`);
    return;
  }

  delete state.pingFailureUntil[key];
  signal.throwIfAborted();
  await deps.updateProviderConnection(conn.id, {
    lastPingedResetAt: triggerResetAt,
    lastPingedResetKey: resetKey,
    lastPingAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  console.log(`[AutoPing] ${provider}:${conn.id}: ping sent`);
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
    refreshProviderQuota,
    listProviderQuotaSnapshots,
    getQuotaFetchState,
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
          state.pingFailureUntil ||= {};
          if (e?.name !== "AbortError") state.pingFailureUntil[cacheKey(provider, conn.id)] = Date.now() + C.failureCooldownMs;
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
  state.pingFailureUntil ||= {};
  if (enabled !== true) {
    state.inflightControllers[key]?.abort(new DOMException("Auto-ping disabled", "AbortError"));
  }
  delete state.pingFailureUntil[key];
  if (enabled === true) runQuotaAutoPingTick().catch(() => {});
}

export function startQuotaAutoPing() {
  if (g.interval) return;
  console.log("[AutoPing] scheduler started");
  runQuotaAutoPingTick().catch(() => {});
  g.interval = setInterval(() => { runQuotaAutoPingTick().catch(() => {}); }, C.tickIntervalMs);
  if (g.interval.unref) g.interval.unref();
}
