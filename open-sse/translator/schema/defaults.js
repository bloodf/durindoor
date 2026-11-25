// Shared translator default values (magic strings used across multiple translators).

// Fallback model id when upstream chunk omits one.
export const MODEL_FALLBACK = "unknown";

// Default image mime when source omits it (base64 blobs without a declared type).
export const DEFAULT_IMAGE_MIME = "image/png";

// OpenAI service_tier values; Anthropic's "standard_only" has no OpenAI twin beyond "default".
export const OPENAI_SERVICE_TIERS = ["auto", "default", "flex", "priority", "scale"];
export const CLAUDE_TO_OPENAI_SERVICE_TIER = { standard_only: "default" };
