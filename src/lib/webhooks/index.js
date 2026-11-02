// Signed operator event webhooks (#1118).
//
// Ported in spirit from OmniRoute src/lib/webhookDispatcher.ts and
// src/shared/network/webhookFetch.ts (diegosouzapw/OmniRoute@61e07fb7, MIT;
// PRs #2703, #13243, #14755). Fork-native differences:
//   - Destinations live in the settings JSON row (`operatorWebhooks`), so no
//     DB migration. Off by default: no destination, no delivery.
//   - Delivery reuses open-sse/utils/outboundUrlGuard.js in "public-only"
//     mode. Its Undici connector validates every DNS answer used by the
//     socket, which closes the DNS-rebinding gap (#13243) without a second
//     pinning implementation. Redirects are never followed.
//   - The signature covers `${timestamp}.${body}` (replay protection), sent as
//     `X-DurinDoor-Signature: t=<unix>,v1=<hex hmac-sha256>`.
//   - Payload data is redacted with the observability redactor, and repeated
//     identical events are throttled so a hot failure loop cannot flood a
//     receiver.

import crypto from "node:crypto";
import { getSettings, updateSettings } from "@/lib/localDb";
import { redactValue } from "@/lib/observability/redact.js";
import {
  OutboundUrlGuardError,
  assertOutboundUrlAllowed,
  guardedProbeFetch
} from "open-sse/utils/outboundUrlGuard.js";
import { isBoolean, isNumber, isObject, isString } from "@/shared/utils/typeChecks.js";

export const WEBHOOK_EVENTS = Object.freeze([
"account.cooldown",
"account.reauth_required",
"quota.exhausted",
"provider.unavailable",
"test.ping"]
);
export const SIGNATURE_HEADER = "X-DurinDoor-Signature";
export const SIGNATURE_TOLERANCE_SEC = 300;
export const MAX_WEBHOOKS = 20;
export const MAX_RETRIES = 3;
export const HISTORY_LIMIT = 20;
export const AUTO_DISABLE_AFTER_FAILURES = 10;
const TIMEOUT_MS = 10_000;
const THROTTLE_MS = 60_000;
const THROTTLE_MAX_KEYS = 500;
const GUARD = "public-only";

// ── signing ────────────────────────────────────────────────────────────────

export function signWebhookBody(secret, timestamp, body) {
  const mac = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

/**
 * Receiver-side check (exported for operators and tests). Rejects a bad MAC
 * and any timestamp outside the tolerance window, so a captured delivery
 * cannot be replayed later.
 */
export function verifyWebhookSignature(secret, header, body, { toleranceSec = SIGNATURE_TOLERANCE_SEC, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  if (!isString(header) || !isString(secret) || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=", 2)));
  const t = Number(parts.t);
  if (!Number.isSafeInteger(t) || !isString(parts.v1) || Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = signWebhookBody(secret, t, body).split("v1=")[1];
  const a = Buffer.from(parts.v1, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── validation ─────────────────────────────────────────────────────────────

export class WebhookValidationError extends Error {}

/** Validate an operator-supplied destination patch. Throws WebhookValidationError. */
export function validateWebhookInput(input, { partial = false } = {}) {
  if (!input || !isObject(input) || Array.isArray(input)) throw new WebhookValidationError("Body must be an object");
  const out = {};
  if (!partial || input.url !== undefined) {
    let url;
    try {
      url = assertOutboundUrlAllowed(input.url, GUARD);
    } catch (error) {
      throw new WebhookValidationError(error instanceof OutboundUrlGuardError ? error.message : "Invalid URL");
    }
    if (url.protocol !== "https:") throw new WebhookValidationError("Webhook URL must use https");
    out.url = url.toString();
  }
  if (!partial || input.events !== undefined) {
    const events = Array.isArray(input.events) ? [...new Set(input.events)] : [];
    if (events.length === 0 || events.some((e) => !WEBHOOK_EVENTS.includes(e))) {
      throw new WebhookValidationError(`events must be a non-empty subset of: ${WEBHOOK_EVENTS.join(", ")}`);
    }
    out.events = events;
  }
  if (input.name !== undefined) {
    if (!isString(input.name) || input.name.length > 80) throw new WebhookValidationError("name must be a string of at most 80 characters");
    out.name = input.name.trim();
  }
  if (input.enabled !== undefined) {
    if (!isBoolean(input.enabled)) throw new WebhookValidationError("enabled must be a boolean");
    out.enabled = input.enabled;
  }
  return out;
}

/** Response shape: the secret never leaves the server after creation. */
export function toPublicWebhook(hook) {
  const { secret, ...rest } = hook;
  return { ...rest, hasSecret: isString(secret) && secret.length > 0 };
}

// ── storage (settings.operatorWebhooks) ────────────────────────────────────

function hooksOf(settings) {
  return Array.isArray(settings?.operatorWebhooks) ? settings.operatorWebhooks : [];
}

export async function listWebhooks() {
  return hooksOf(await getSettings());
}

export async function createWebhook(input) {
  const valid = validateWebhookInput(input);
  const hook = {
    id: crypto.randomUUID(),
    name: valid.name || "",
    url: valid.url,
    events: valid.events,
    enabled: valid.enabled ?? true,
    secret: crypto.randomBytes(32).toString("hex"),
    createdAt: new Date().toISOString(),
    consecutiveFailures: 0,
    history: []
  };
  let tooMany = false;
  await updateSettings((current) => {
    const hooks = hooksOf(current);
    if (hooks.length >= MAX_WEBHOOKS) {
      tooMany = true;
      return {};
    }
    return { operatorWebhooks: [...hooks, hook] };
  });
  if (tooMany) throw new WebhookValidationError(`At most ${MAX_WEBHOOKS} webhooks`);
  return hook;
}

/** Apply `fn(hook) -> hook` to one destination atomically. Returns the result or null. */
async function mutateWebhook(id, fn) {
  let result = null;
  await updateSettings((current) => {
    const hooks = hooksOf(current);
    const index = hooks.findIndex((h) => h.id === id);
    if (index === -1) return {};
    result = fn(hooks[index]);
    const next = result === undefined ? hooks.filter((_, i) => i !== index) : hooks.map((h, i) => i === index ? result : h);
    return { operatorWebhooks: next };
  });
  return result;
}

export async function updateWebhook(id, input) {
  const patch = validateWebhookInput(input, { partial: true });
  // Re-enabling clears the failure streak that may have auto-disabled it.
  return mutateWebhook(id, (hook) => ({ ...hook, ...patch, ...(patch.enabled ? { consecutiveFailures: 0 } : null) }));
}

export async function deleteWebhook(id) {
  let found = false;
  await mutateWebhook(id, () => {
    found = true;
    return undefined;
  });
  return found;
}

// ── delivery ───────────────────────────────────────────────────────────────

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST one signed payload with bounded retries (1s, 2s, 4s). Retries only on
 * network errors, 429 and 5xx; a guard block, redirect or other 4xx is final.
 */
export async function deliverWebhook(hook, payload, { fetcher = fetch, sleep = defaultSleep, nowSec } = {}) {
  const body = JSON.stringify(payload);
  let last = { ok: false, status: 0, error: "not attempted", attempts: 0 };
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    const timestamp = nowSec ?? Math.floor(Date.now() / 1000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await guardedProbeFetch(hook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "DurinDoor-Webhook/1",
          "X-DurinDoor-Event": payload.event,
          "X-DurinDoor-Delivery": payload.id,
          [SIGNATURE_HEADER]: signWebhookBody(hook.secret, timestamp, body)
        },
        body,
        signal: controller.signal
      }, GUARD, fetcher);
      last = { ok: res.ok, status: res.status, error: res.ok ? null : `HTTP ${res.status}`, attempts: attempt + 1 };
      if (res.ok || res.status >= 300 && res.status < 500 && res.status !== 429) return last;
    } catch (error) {
      last = { ok: false, status: 0, error: String(error?.message || error).slice(0, 200), attempts: attempt + 1 };
      if (error instanceof OutboundUrlGuardError) return last;
    } finally {
      clearTimeout(timer);
    }
  }
  return last;
}

function recordResult(hook, event, result) {
  const entry = { at: new Date().toISOString(), event, ok: result.ok, status: result.status, attempts: result.attempts, error: result.error };
  const consecutiveFailures = result.ok ? 0 : (hook.consecutiveFailures || 0) + 1;
  return {
    ...hook,
    consecutiveFailures,
    enabled: consecutiveFailures >= AUTO_DISABLE_AFTER_FAILURES ? false : hook.enabled,
    lastDeliveryAt: entry.at,
    history: [entry, ...(Array.isArray(hook.history) ? hook.history : [])].slice(0, HISTORY_LIMIT)
  };
}

const recentEvents = new Map();

function throttled(key, now) {
  const last = recentEvents.get(key);
  if (isNumber(last) && now - last < THROTTLE_MS) return true;
  if (recentEvents.size >= THROTTLE_MAX_KEYS) recentEvents.delete(recentEvents.keys().next().value);
  recentEvents.set(key, now);
  return false;
}

/**
 * Deliver `event` to every enabled matching destination and record history.
 * `throttleKey` collapses identical events within 60 s. Never throws.
 */
export async function dispatchWebhookEvent(event, data = {}, { throttleKey, fetcher, sleep, hooks } = {}) {
  try {
    const targets = (hooks ?? await listWebhooks()).filter((h) => h.enabled === true && h.events?.includes(event));
    if (targets.length === 0) return [];
    if (throttleKey && throttled(`${event}:${throttleKey}`, Date.now())) return [];
    const payload = { id: crypto.randomUUID(), event, timestamp: new Date().toISOString(), data: redactValue(data) };
    return await Promise.all(targets.map(async (hook) => {
      const result = await deliverWebhook(hook, payload, { fetcher, sleep });
      try {
        await mutateWebhook(hook.id, (current) => recordResult(current, event, result));
      } catch {
        // history is best-effort
      }
      return { id: hook.id, ...result };
    }));
  } catch {
    return [];
  }
}

/** Fire-and-forget entry point for hot paths. */
export function notifyWebhookEvent(event, data, options) {
  void dispatchWebhookEvent(event, data, options);
}

export const __test__ = { resetThrottle: () => recentEvents.clear() };
