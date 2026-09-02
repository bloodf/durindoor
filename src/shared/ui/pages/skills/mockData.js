const rawSkillBase = "https://raw.githubusercontent.com/bloodf/durindoor/refs/heads/main/skills";

export const endpointOptions = [
  { value: "http://localhost:20128/v1", label: "Local — http://localhost:20128/v1" },
  {
    value: "https://tim-rpg-philips-merchandise.trycloudflare.com/v1",
    label: "Tunnel — https://tim-rpg-philips-merchandise.trycloudflare.com/v1",
  },
  {
    value: "https://cortexos.tailfd052e.ts.net:11434/v1",
    label: "Tailscale — https://cortexos.tailfd052e.ts.net:11434/v1",
  },
  { value: "custom", label: "Custom…" },
];

export const apiKeyOptions = [
  { value: "sk-••••C0r", label: "Cortex — sk-••••C0r" },
  { value: "sk-••••H3r", label: "Hermes - Cortex — sk-••••H3r" },
  { value: "sk-••••D1n", label: "Space Dino — sk-••••D1n" },
  { value: "", label: "No key (public endpoint)" },
];

export const skills = [
  {
    name: "DurinDoor",
    badge: "START HERE",
    icon: "door_open",
    description: "Set up your gateway connection and discover available capabilities.",
    url: `${rawSkillBase}/durindoor/SKILL.md`,
  },
  {
    name: "Chat",
    endpoint: "/v1/chat/completions",
    icon: "chat",
    description: "Send OpenAI-compatible chat and code-generation requests.",
    url: `${rawSkillBase}/durindoor-chat/SKILL.md`,
  },
  {
    name: "Image Generation",
    endpoint: "/v1/images/generations",
    icon: "image",
    description: "Create images from prompts with a discovered image model.",
    url: `${rawSkillBase}/durindoor-image/SKILL.md`,
  },
  {
    name: "Text-to-Speech",
    endpoint: "/v1/audio/speech",
    icon: "record_voice_over",
    description: "Turn text into speech using voices available through your gateway.",
    url: `${rawSkillBase}/durindoor-tts/SKILL.md`,
  },
  {
    name: "Speech-to-Text",
    endpoint: "/v1/audio/transcriptions",
    icon: "graphic_eq",
    description: "Transcribe uploaded audio with a discovered speech model.",
    url: `${rawSkillBase}/durindoor-stt/SKILL.md`,
  },
  {
    name: "Embeddings",
    endpoint: "/v1/embeddings",
    icon: "scatter_plot",
    description: "Generate OpenAI-compatible vector embeddings for text.",
    url: `${rawSkillBase}/durindoor-embeddings/SKILL.md`,
  },
  {
    name: "Web Search",
    endpoint: "/v1/search",
    icon: "travel_explore",
    description: "Search the web with a webSearch model returned by discovery.",
    url: `${rawSkillBase}/durindoor-web-search/SKILL.md`,
  },
  {
    name: "Web Fetch",
    endpoint: "/v1/web/fetch",
    icon: "language",
    description: "Fetch and extract a URL with a discovered webFetch model.",
    url: `${rawSkillBase}/durindoor-web-fetch/SKILL.md`,
  },
];

export const entrySkill = skills[0];
