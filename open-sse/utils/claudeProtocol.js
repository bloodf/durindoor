import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";

// Claude OAuth request policy, adapted from CLIProxyAPI 6eb8554f0ede (MIT).
export const CLAUDE_FAST_MODE_BETA = "fast-mode-2026-02-01";

export function isClaudeFastRequest(body, requestedBetas) {
  return (isString(body?.speed) && body.speed.trim().toLowerCase() === "fast") ||
    requestedBetas.includes(CLAUDE_FAST_MODE_BETA);
}

const CLAUDE_NEGOTIATED_BETAS = new Set([
  CLAUDE_FAST_MODE_BETA,
  "context-1m-2025-08-07",
  "mid-conversation-system-2026-04-07",
  "mid-conversation-output-config-2026-07-01",
  "mid-conversation-system-clear-at-2026-08-21",
  "advisor-tool-2026-03-01",
  "server-side-fallback-2026-06-01",
  "fallback-credit-2026-06-01",
  "structured-outputs-2025-12-15",
  "thinking-resumption-2026-07-17",
  "prompt-caching-evict-2026-05-12",
  "message-threads-2026-08-12",
]);

export function claudeRequestedBetas(body, clientHeaders, forwardableBetas) {
  const header = new Headers(clientHeaders ?? undefined).get("anthropic-beta");
  const betas = Array.isArray(body?.betas) ? body.betas : [body?.betas];
  return [header, ...betas].filter(isString).join(",").split(",").map((beta) => beta.trim())
    .filter((beta) => CLAUDE_NEGOTIATED_BETAS.has(beta) || forwardableBetas?.has(beta));
}

export function prepareClaudeOAuthBody(body) {
  if (!isRecord(body)) return body;
  const prepared = { ...body };
  delete prepared.betas;
  if (["any", "tool"].includes(prepared.tool_choice?.type)) {
    delete prepared.thinking;
    if (isRecord(prepared.output_config) && Object.hasOwn(prepared.output_config, "effort")) {
      prepared.output_config = { ...prepared.output_config };
      delete prepared.output_config.effort;
      if (Object.keys(prepared.output_config).length === 0) delete prepared.output_config;
    }
  }
  return prepared;
}

export function claudeFunctionalBetas(body) {
  const betas = [];
  if (body?.speed != null) betas.push(CLAUDE_FAST_MODE_BETA);
  if (body?.thinking?.block_binding != null) betas.push("thinking-binding-controls-2026-08-01");
  if (body?.safeguards != null) betas.push("dangerous-tool-use-2026-09-03");
  if (Array.isArray(body?.fallbacks) && body.fallbacks.length > 0) {
    betas.push("server-side-fallback-2026-06-01", "fallback-credit-2026-06-01");
  } else if (body?.fallback_credit_token != null) {
    betas.push("fallback-credit-2026-06-01");
  }
  if (isRecord(body?.thread)) betas.push("message-threads-2026-08-12");
  if (isRecord(body?.diagnostics)) betas.push("cache-diagnosis-2026-04-07");
  if (Array.isArray(body?.messages) && body.messages.some((message) => isRecord(message?.output_config))) {
    betas.push("mid-conversation-output-config-2026-07-01");
  }
  if (Array.isArray(body?.messages) && body.messages.some((message) => message?.tool_addition != null)) {
    betas.push("inline-tools-2026-09-15");
  }
  return betas;
}

export function claudeFastCreditsRequired(message) {
  const lower = message.toLowerCase();
  return lower.includes("fast request rejected") ||
    (lower.includes("fast") && (lower.includes("usage credits") || lower.includes("credits are required")));
}

export function claudeUnifiedQuotaRejected(headers) {
  const get = (field) => headers.get(`anthropic-ratelimit-unified-${field}`)?.trim().toLowerCase() ?? "";
  const fiveHour = get("5h-status");
  const weekly = get("7d-status");
  if (fiveHour === "rejected" || weekly === "rejected") return true;
  if (get("status") !== "rejected") return false;

  const claim = get("representative-claim");
  const overage = claim.includes("overage") || get("7d_oi-status") === "rejected" ||
    get("overage-status") === "rejected" || Boolean(get("overage-disabled-reason"));
  if (!overage) return true;

  const allowed = (status) => status === "allowed" || status === "allowed_warning";
  const healthy = (window) => {
    const value = get(`${window}-utilization`);
    return value !== "" && Number(value) >= 0 && Number(value) < 1;
  };
  const absentOrHealthy = (window) => !get(`${window}-utilization`) || healthy(window);
  if (allowed(weekly) && (allowed(fiveHour) || (!fiveHour && absentOrHealthy("5h")))) return false;
  if (allowed(fiveHour) && !weekly && healthy("7d")) return false;
  return !(!fiveHour && !weekly && claim.includes("overage") && absentOrHealthy("5h") && absentOrHealthy("7d"));
}

export function isClaudeRequestScopedError(status, headers, message, fast) {
  if (status < 400) return false;
  if (status !== 429) return fast;
  return !claudeUnifiedQuotaRejected(headers) && (fast || claudeFastCreditsRequired(message));
}

// Only explicit shared quota evidence may turn a Fast refusal into an
// account-wide cooldown. Skip an overage billing boundary as a reset hint.
export function claudeUnifiedResetAt(headers, now, maxDelayMs) {
  const get = (field) => headers.get(`anthropic-ratelimit-unified-${field}`)?.trim() ?? "";
  const dates = [];
  for (const window of ["5h", "7d", "7d_oi"]) {
    if (get(`${window}-status`).toLowerCase() === "rejected") dates.push(get(`${window}-reset`));
  }
  const unified = get("reset");
  const overageBoundary = get("representative-claim").toLowerCase().includes("overage") &&
    unified === get("overage-reset");
  if (!overageBoundary) dates.push(unified);
  const deadlines = dates.map((value) => /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value))
    .filter((deadline) => deadline > now && deadline <= now + maxDelayMs);
  return deadlines.length ? Math.max(...deadlines) : null;
}
