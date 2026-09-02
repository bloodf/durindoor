export const PROVIDER_OPTIONS = [
  { value: "all", label: "All Providers" },
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
  { value: "minimax", label: "MiniMax" },
  { value: "xai", label: "xai" },
];

export const ACCOUNT_OPTIONS = [
  { value: "all", label: "All accounts" },
  { value: "personal", label: "Personal" },
  { value: "team", label: "Team workspace" },
];

export const SORT_OPTIONS = [
  { value: "expiring", label: "Expiring first" },
  { value: "availability", label: "Lowest availability" },
  { value: "provider", label: "Provider name" },
];

export const QUOTA_PROVIDERS = [
  {
    id: "claude",
    initial: "C",
    name: "Claude",
    subtitle: "Claude Code · Personal",
    state: "Rate limited",
    stateTone: "danger",
    detail: "Next reset in 38m",
    quotas: [],
  },
  {
    id: "codex",
    initial: "O",
    name: "Codex",
    subtitle: "OpenAI · Team workspace",
    quotas: [
      { name: "5-hour window", used: 22, limit: 100, expires: "in 5d 14h 17m" },
      { name: "Weekly", used: 47, limit: 100, expires: "in 2d 6h 12m" },
      { name: "Code review", used: 8, limit: 50, expires: "in 5d 14h 17m" },
    ],
  },
  {
    id: "minimax",
    initial: "M",
    name: "MiniMax",
    subtitle: "MiniMax · Heitor",
    quotas: [
      { name: "Daily requests", used: 386, limit: 500, expires: "in 14h 38m" },
      { name: "Monthly tokens", used: 6.2, limit: 10, unit: "M", expires: "in 18d 4h" },
      { name: "Video generation", used: 3, limit: 10, expires: "in 14h 38m" },
      { name: "Image generation", used: 92, limit: 200, expires: "in 14h 38m" },
    ],
  },
  {
    id: "xai",
    initial: "X",
    name: "xAI",
    subtitle: "xAI · Developer account",
    quotas: [
      { name: "Hourly requests", used: 12, limit: 60, expires: "in 44m" },
      { name: "Daily requests", used: 831, limit: 1000, expires: "in 14h 38m" },
      { name: "Weekly SuperGrok", used: 100, limit: 100, expires: "in 2d 6h" },
      { name: "Monthly tokens", used: 18.4, limit: 25, unit: "M", expires: "in 18d 4h" },
      { name: "Image generation", used: 16, limit: 50, expires: "in 14h 38m" },
    ],
  },
];

export const FILTERED_PROVIDERS = QUOTA_PROVIDERS.filter((provider) => provider.id === "codex");
