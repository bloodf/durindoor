// Web-session chat endpoints open a real conversation on the user's account per probe;
// automated probes get accounts suspended (OmniRoute #14780/#14818). Callers MUST skip
// (not fail) and never persist an error status for these providers. Read-only session
// checks (e.g. perplexity-web GET /api/auth/session) create nothing and stay allowed.
// suno and udio belong here too: their only generic probe POSTs the music submit endpoint,
// which starts a billable generation on the account.
// notrack-web has no read-only endpoint: its only request is the chat dispatch.
// poe-web and v0-vercel-web have no read-only endpoint either (#2034, 1127): their only request
// is the chat dispatch, so a saved cookie is checked locally and the probe is skipped.
const CONVERSATION_PROBE_PROVIDERS = new Set(["grok-web", "copilot-web", "zenmux-free", "adapta-web", "yuanbao-web", "doubao-web", "zai-web", "notrack-web", "cloudflare-playground", "suno", "udio", "poe-web", "v0-vercel-web"]);

// Web sessions whose dispatch is deliberately closed (#2034): the executor returns provider_port_pending
// because no authorized, verified non-browser request contract exists. Validate and Test Connection must
// not send the saved cookie anywhere either; the generic probe would POST it as a Bearer token to the
// provider's chat endpoint (huggingface.co/chat/conversation creates a conversation).
const GUARDED_WEB_SESSION_PROVIDERS = new Set(["muse-spark-web", "huggingchat", "twinmind", "hyperagent"]);

export const isGuardedWebSessionProvider = (provider) => GUARDED_WEB_SESSION_PROVIDERS.has(provider);

export const isConversationProbeProvider = (provider) =>
  CONVERSATION_PROBE_PROVIDERS.has(provider) || GUARDED_WEB_SESSION_PROVIDERS.has(provider);

export const SKIPPED_WEB_SESSION_ERROR =
  "Skipped: web-session providers are not probed automatically to avoid creating provider conversations";

export const GUARDED_WEB_SESSION_ERROR =
  "Skipped: gateway dispatch for this web session is not enabled, so the saved cookie is stored but never sent to the provider";

/** Skip reason for a probe that must not run for `provider`. */
export const skippedWebSessionError = (provider) =>
  GUARDED_WEB_SESSION_PROVIDERS.has(provider) ? GUARDED_WEB_SESSION_ERROR : SKIPPED_WEB_SESSION_ERROR;

// UI outcome of a probe payload. "skipped" is neither success nor failure: never colour it as an
// error, never count it as failed, never auto-hide/disable/persist a bad status because of it.
export const probeOutcome = (data, okKey = "ok") => (data?.skipped ? "skipped" : data?.[okKey] ? "ok" : "error");
