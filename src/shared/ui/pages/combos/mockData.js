export const strategyOptions = [
  { value: "fallback", label: "Fallback — try in order" },
  { value: "round-robin", label: "Round Robin" },
  { value: "fusion", label: "Fusion" },
  { value: "smart-score", label: "Smart Scoring — best score first" },
  { value: "smart-quality", label: "Smart Scoring — best quality first" },
  { value: "capacity", label: "Capacity auto-switch" },
];

export const strategyDescriptions = [
  {
    name: "Fallback",
    icon: "format_list_numbered",
    description: "Try models in order until one returns a healthy response.",
  },
  {
    name: "Round Robin",
    icon: "autorenew",
    description: "Rotate requests evenly across every available model.",
  },
  {
    name: "Fusion",
    icon: "merge",
    description: "Run models together and combine their strongest response signals.",
  },
  {
    name: "Smart Scoring",
    icon: "hotel_class",
    description: "Route by live quality, latency, and reliability scores.",
  },
  {
    name: "Capacity auto-switch",
    icon: "swap_horiz",
    description: "Move traffic when quota or provider capacity runs low.",
  },
];

export const combos = [
  {
    id: "engineer",
    name: "engineer",
    context: "1M",
    maxOutput: "128k",
    strategy: "smart-score",
    timeout: 120,
    featured: true,
    models: [
      { id: "codex/gpt-5.6-sol", health: "success" },
      { id: "cc/claude-fable-5", health: "success" },
      { id: "gemini/gemini-3.1-pro", health: "warning" },
    ],
  },
  {
    id: "planner",
    name: "planner",
    context: "1M",
    maxOutput: "128k",
    strategy: "smart-quality",
    timeout: 180,
    models: [
      { id: "cc/claude-fable-5", health: "success" },
      { id: "codex/gpt-5.6-sol", health: "success" },
    ],
  },
  {
    id: "webdesigner",
    name: "webdesigner",
    context: "1M",
    maxOutput: "64k",
    strategy: "fallback",
    timeout: 120,
    models: [
      { id: "gemini/gemini-3.1-pro", health: "success" },
      { id: "cc/claude-fable-5", health: "warning" },
      { id: "openai/gpt-5.4", health: "success" },
    ],
  },
  {
    id: "fast",
    name: "fast",
    context: "400k",
    maxOutput: "32k",
    strategy: "fallback",
    timeout: 45,
    models: [
      { id: "openai/gpt-5.4-mini", health: "success" },
      { id: "gemini/gemini-3.1-flash", health: "success" },
    ],
  },
  {
    id: "staff-engineer",
    name: "staff-engineer",
    context: "1M",
    maxOutput: "128k",
    strategy: "smart-score",
    timeout: 150,
    models: [
      { id: "codex/gpt-5.6-sol", health: "success" },
      { id: "cc/claude-fable-5", health: "warning" },
      { id: "gemini/gemini-3.1-pro", health: "success" },
    ],
  },
  {
    id: "mid-engineer",
    name: "mid-engineer",
    context: "400k",
    maxOutput: "64k",
    strategy: "capacity",
    timeout: 90,
    models: [
      { id: "openai/gpt-5.4", health: "success" },
      { id: "gemini/gemini-3.1-flash", health: "warning" },
    ],
  },
  {
    id: "hermes",
    name: "hermes",
    context: "200k",
    maxOutput: "32k",
    strategy: "round-robin",
    timeout: 60,
    models: [
      { id: "openai/gpt-5.4-mini", health: "success" },
      { id: "anthropic/claude-sonnet-4.6", health: "success" },
      { id: "gemini/gemini-3.1-flash", health: "success" },
    ],
  },
];
