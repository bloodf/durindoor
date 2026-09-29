// Web-session chat endpoints open a real conversation on the user's account per probe;
// automated probes get accounts suspended (OmniRoute #14780/#14818). Callers MUST skip
// (not fail) and never persist an error status for these providers. Read-only session
// checks (e.g. perplexity-web GET /api/auth/session) create nothing and stay allowed.
const CONVERSATION_PROBE_PROVIDERS = new Set(["grok-web", "copilot-web", "zenmux-free"]);

export const isConversationProbeProvider = (provider) => CONVERSATION_PROBE_PROVIDERS.has(provider);

export const SKIPPED_WEB_SESSION_ERROR =
  "Skipped: web-session providers are not probed automatically to avoid creating provider conversations";

// UI outcome of a probe payload. "skipped" is neither success nor failure: never colour it as an
// error, never count it as failed, never auto-hide/disable/persist a bad status because of it.
export const probeOutcome = (data, okKey = "ok") => (data?.skipped ? "skipped" : data?.[okKey] ? "ok" : "error");
