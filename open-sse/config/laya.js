// Laya (local "System One" decision engine) — constants only.
// Per open-sse/AGENTS.md: ALL config lives here, nothing is hardcoded elsewhere.
//
// `laya-serve` (https://github.com/NandhaKishorM/laya) exposes Laya over the
// same `POST /v1/systemone` wire protocol as TypeSafe Jev, so the Jev client in
// services/jevClassifier.js talks to it unchanged. Differences from Jev: the
// server is user-run (host per connection), the bearer key is optional
// (`LAYA_API_KEY` on the server), `model` may be left out so Laya's own router
// picks a checkpoint, inference is local (no spend), and CPU inference is
// slower than the hosted API, hence the longer deadline.

export const LAYA_PROVIDER_ID = "laya";
export const LAYA_DEFAULT_HOST = "http://127.0.0.1:8000";
export const LAYA_HEALTH_PATH = "/health";

// Checkpoints `laya-serve` accepts in `model`; anything else auto-routes.
export const LAYA_CHECKPOINTS = ["english", "multilingual", "typed-decisions"];

// Local CPU inference takes hundreds of ms to seconds; the first call after a
// lazy start can load a checkpoint. Still bounded so routing never stalls.
export const LAYA_TIMEOUT_MS = 8000;

// Threshold on Laya's calibrated `answer_confidence` (max probability over the
// four tiers; chance is 0.25). Zero-shot answers on coding asks land around
// 0.4-0.55, so Jev's 0.5 would discard most correct tiers.
export const LAYA_MIN_CONFIDENCE = 0.4;

/**
 * Resolve the per-connection Laya origin. Only the origin is honored, so a
 * stored path, query or fragment cannot redirect prompts elsewhere; anything
 * that is not an http(s) URL falls back to the default host.
 * @param {object|null} connection - connection or credentials with providerSpecificData
 * @returns {string}
 */
export function resolveLayaHost(connection) {
  const raw = connection?.providerSpecificData?.baseUrl?.trim?.();
  if (!raw) return LAYA_DEFAULT_HOST;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return LAYA_DEFAULT_HOST;
    return url.origin;
  } catch {
    return LAYA_DEFAULT_HOST;
  }
}

/** A connection's pinned checkpoint, or null to let Laya's router choose. */
export function resolveLayaCheckpoint(connection) {
  const model = connection?.providerSpecificData?.model;
  return LAYA_CHECKPOINTS.includes(model) ? model : null;
}
