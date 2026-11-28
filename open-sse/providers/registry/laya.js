/**
 * Laya — self-hosted "System One" decision engine.
 *
 * Not a chat model: Laya answers typed questions (choice / score / yes-no) over
 * a text in one forward pass. `laya-serve` speaks TypeSafe Jev's
 * `POST /v1/systemone` protocol, so DurinDoor uses an active Laya connection in
 * place of Jev for the smart/task combo complexity classifier (see
 * src/sse/services/decisionBackend.js).
 *
 * - **User-supplied host.** The server is user-run, so its origin lives per
 *   connection in `providerSpecificData.baseUrl` (resolved by resolveLayaHost).
 * - **Optional key.** `laya-serve` only checks a bearer token when started with
 *   `LAYA_API_KEY`; the host stands in for the key (`apiKeyOptionalWith`).
 * - **System One kind, no chat transport.** Its checkpoints are served on
 *   `POST /v1/systemone` (`model: "laya/english"`) and the System One media
 *   page, never as chat models.
 */
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
 * stored path, query or fragment cannot redirect prompts elsewhere. An empty
 * value means the default host; `host:port` without a scheme means http. Any
 * other value, or an http(s) URL carrying a username or password, returns
 * null, so callers refuse it instead of calling some other host.
 * @param {object|null} connection - connection or credentials with providerSpecificData
 * @returns {string|null}
 */
export function resolveLayaHost(connection) {
  const raw = connection?.providerSpecificData?.baseUrl?.trim?.();
  if (!raw) return LAYA_DEFAULT_HOST;
  // Only `http(s)://...` or a bare `host:port` / `[ipv6]:port`; anything else
  // (a typo such as `http:/host`, another scheme) is refused, not reinterpreted.
  let candidate = null;
  if (/^https?:\/\//i.test(raw)) candidate = raw;
  else if (/^(\[[0-9a-f:.]+\]|[a-z0-9.-]+):\d{1,5}$/i.test(raw)) candidate = `http://${raw}`;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    // Userinfo would be dropped by `origin`, turning `http://127.0.0.1:8000@evil.com` into evil.com.
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** A connection's pinned checkpoint, or null to let Laya's router choose. */
export function resolveLayaCheckpoint(connection) {
  const model = connection?.providerSpecificData?.model;
  return LAYA_CHECKPOINTS.includes(model) ? model : null;
}

export default {
  id: "laya",
  priority: 60,
  alias: "laya",
  display: {
    name: "Laya (local)",
    icon: "rule",
    color: "#2ea44f",
    textIcon: "LY",
    website: "https://github.com/NandhaKishorM/laya",
    notice: {
      text: "Run `pip install \"laya[serve]\"` then `laya-serve` (default http://127.0.0.1:8000). Set the API key only if the server was started with LAYA_API_KEY. Laya serves POST /v1/systemone (model laya/english, laya/multilingual, ...) and, while connected, replaces Jev for smart/task combo routing.",
    },
  },
  category: "apikey",
  apiKeyOptionalWith: "baseUrl",
  models: [
    { id: "auto", name: "Laya router (picks the checkpoint)", kind: "systemone", contextLength: 1024 },
    { id: "english", name: "Laya English (ModernBERT-large)", kind: "systemone", contextLength: 512 },
    { id: "multilingual", name: "Laya Multilingual (mmBERT-base, 100+ languages)", kind: "systemone", contextLength: 1024 },
    { id: "typed-decisions", name: "Laya Typed Decisions", kind: "systemone", contextLength: 1024 },
  ],
  serviceKinds: ["systemone"],
  // Default host only; the origin comes from the connection's base URL
  // (userConfigurableHost), resolved in systemoneCore.
  systemoneConfig: {
    baseUrl: "http://127.0.0.1:8000/v1/systemone",
    userConfigurableHost: true,
  },
};
