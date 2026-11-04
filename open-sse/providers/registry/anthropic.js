export default {
  id: "anthropic",
  priority: 30,
  alias: "anthropic",
  display: {
    name: "Anthropic",
    icon: "smart_toy",
    color: "#D97757",
    textIcon: "AN",
    website: "https://console.anthropic.com",
    notice: {
      apiKeyUrl: "https://console.anthropic.com/settings/keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.anthropic.com/v1/messages",
    format: "claude",
    headers: {
      // Keep lowercase to match merged forwarded-header keys and avoid duplicate logical entries.
      "anthropic-version": "2023-06-01",
      "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14",
    },
  },
  models: [
    // Official lifecycle table, 2026-10-01. Keep current short aliases
    // for dated pinned snapshots.
    { id: "claude-fable-5-1", name: "Claude Fable 5.1" },
    { id: "claude-mythos-5-1", name: "Claude Mythos 5.1" },
    { id: "claude-fable-5", name: "Claude Fable 5", lifecycle: "legacy" },
    { id: "claude-mythos-5", name: "Claude Mythos 5" },
    { id: "claude-mythos-preview", name: "Claude Mythos Preview", lifecycle: "deprecated" },
    { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
    { id: "claude-opus-5", name: "Claude Opus 5", lifecycle: "legacy" },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8", lifecycle: "legacy" },
    { id: "claude-opus-4-7", name: "Claude Opus 4.7", lifecycle: "legacy" },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6", lifecycle: "legacy" },
    { id: "claude-opus-4-5-20251101", name: "Claude Opus 4.5", lifecycle: "legacy" },
    { id: "claude-opus-4-5", name: "Claude Opus 4.5 (alias)", lifecycle: "legacy" },
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5", lifecycle: "legacy" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", lifecycle: "legacy" },
    { id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5", lifecycle: "deprecated" },
    { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5 (alias)", lifecycle: "deprecated" },
    { id: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", lifecycle: "legacy" },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5 (alias)", lifecycle: "legacy" },
  ],
  serviceKinds: ["llm","imageToText"],
};
