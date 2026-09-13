// Static catalog data for the providers domain: TTS voices, Kilo free models,
// seeded custom/disabled models and health probe outcomes.
const LANGUAGES = [
  { code: "en-US", name: "English (United States)", voices: ["Aria", "Guy", "Jenny", "Davis"] },
  { code: "en-GB", name: "English (United Kingdom)", voices: ["Sonia", "Ryan", "Libby"] },
  { code: "de-DE", name: "German (Germany)", voices: ["Katja", "Conrad", "Amala"] },
  { code: "fr-FR", name: "French (France)", voices: ["Denise", "Henri", "Eloise"] },
  { code: "ja-JP", name: "Japanese (Japan)", voices: ["Nanami", "Keita"] },
  { code: "pt-BR", name: "Portuguese (Brazil)", voices: ["Francisca", "Antonio", "Thalita"] },
  { code: "es-ES", name: "Spanish (Spain)", voices: ["Elvira", "Alvaro"] },
];

const ELEVENLABS_VOICES = {
  "en-US": [["21m00Tcm4TlvDq8ikWAM", "Rachel"], ["pNInz6obpgDQGcFmaJgB", "Adam"], ["EXAVITQu4vr4xnSDxMaL", "Bella"], ["ErXwobaYiN019PkySvjV", "Antoni"]],
  "en-GB": [["onwK4e9ZLuTAKqWW03F9", "Daniel"], ["ThT5KcBeYPX3keUQqHPh", "Dorothy"]],
  "de-DE": [["zcAOhNBS3c14rBihAFp1", "Giovanni"]],
  "pt-BR": [["CwhRBWXzGAHq8TQ4Fs17", "Roger"]],
};

function voiceId(provider, code, name) {
  if (provider === "edge-tts" || provider === "local-device") return `${code}-${name}Neural`;
  if (provider === "deepgram") return `aura-2-${name.toLowerCase()}-${code.slice(0, 2)}`;
  if (provider === "minimax") return `${code.slice(0, 2)}_${name}_calm`;
  return `${name.toLowerCase()}-${code.toLowerCase()}`;
}

/** `{ languages, byLang }` voice listing in the shape TtsExampleCard expects. */
export function ttsVoiceListing(provider) {
  const byLang = {};
  if (provider === "elevenlabs") {
    for (const [code, voices] of Object.entries(ELEVENLABS_VOICES)) {
      const lang = LANGUAGES.find((entry) => entry.code === code);
      byLang[code] = { code, name: lang?.name || code, voices: voices.map(([id, name]) => ({ id, name })) };
    }
  } else {
    for (const lang of LANGUAGES) {
      byLang[lang.code] = {
        code: lang.code,
        name: lang.name,
        voices: lang.voices.map((name) => ({ id: voiceId(provider, lang.code, name), name, gender: name.endsWith("a") ? "Female" : "Male" })),
      };
    }
  }
  const languages = Object.values(byLang)
    .map(({ code, name, voices }) => ({ code, name, count: voices.length }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { languages, byLang, voices: Object.values(byLang).flatMap((lang) => lang.voices) };
}

export const KILO_FREE_MODELS = [
  { id: "kilo/auto-free", name: "Kilo Auto (Free)", contextLength: 200_000 },
  { id: "x-ai/grok-code-fast-1:free", name: "Grok Code Fast 1 (Free)", contextLength: 256_000 },
  { id: "qwen/qwen3-coder:free", name: "Qwen3 Coder (Free)", contextLength: 262_144 },
  { id: "moonshotai/kimi-k2:free", name: "Kimi K2 (Free)", contextLength: 131_072 },
];

export function seedCustomModels() {
  return [
    { providerAlias: "openai-compatible-ravenhill", id: "llama-4-maverick", type: "llm", name: "Llama 4 Maverick", capabilities: { contextWindow: 1_000_000, vision: true } },
    { providerAlias: "openai-compatible-ravenhill", id: "qwen3-coder-480b", type: "llm", name: "Qwen3 Coder 480B", capabilities: { contextWindow: 262_144, reasoning: true } },
    { providerAlias: "ollama-local", id: "qwen3-coder:30b", type: "llm", name: "qwen3-coder:30b", capabilities: { contextWindow: 131_072 } },
    { providerAlias: "ollama-local", id: "nomic-embed-text", type: "embedding", name: "nomic-embed-text", capabilities: {} },
    { providerAlias: "custom-embedding-forge", id: "bge-m3", type: "embedding", name: "bge-m3", capabilities: {} },
  ];
}

export function seedDisabledModels() {
  return { gh: ["goldeneye-free-auto"], cx: ["gpt-5.1-codex-mini"] };
}

// Probe outcomes keyed by connection id; anything missing probes healthy.
export const HEALTH_OVERRIDES = {
  "conn-codex-backup": { state: "degraded", statusCode: 429, latencyMs: 412, error: "Rate limit reached for gpt-5.5 (429)" },
  "conn-cursor": { state: "down", statusCode: 402, latencyMs: 238, error: "Monthly quota exhausted" },
  "conn-ravenhill": { state: "degraded", statusCode: 200, latencyMs: 1840, error: "Slow response (1840ms)" },
  "conn-firecrawl": { state: "unconfigured", statusCode: null, latencyMs: null, error: "No probe endpoint for this provider" },
};
