const CLOUDFLARE_HOST = "https://tim-rpg-philips-merchandise.trycloudflare.com";

export const endpointRows = [
  {
    id: "local",
    label: "Local",
    url: "http://localhost:20128/v1",
  },
  {
    id: "tunnel",
    label: "Tunnel",
    scope: "External",
    url: `${CLOUDFLARE_HOST}/v1`,
  },
  {
    id: "tailscale",
    label: "Tailscale",
    scope: "External",
    url: "https://cortexos.tailfd052e.ts.net:11434/v1",
  },
];

export const cloudflareEndpoints = [
  {
    id: "cloudflare-responses",
    label: "Responses API",
    url: `${CLOUDFLARE_HOST}/v1/responses`,
  },
  {
    id: "cloudflare-messages",
    label: "Anthropic API",
    url: `${CLOUDFLARE_HOST}/v1/messages`,
  },
];

const keyNames = [
  "Cortex",
  "Hermes - Cortex",
  "Hermes - Cleo",
  "Hermes - Second Brain",
  "MacBook - Claude-mem",
  "Space Dino",
  "Crocs",
  "XRite",
  "Express.com",
  "Hermes - MacBook",
  "Macbook - DSH",
  "GrokBot",
  "KimiCode - Macbook",
  "Grok-FPS",
  "DurinDoor CLI",
  "CI Release",
  "Home Assistant",
  "Jupiter",
  "Minerva",
  "Codex - MacBook",
];

export const apiKeys = keyNames.map((name, index) => ({
  id: `key-${index + 1}`,
  name,
  maskedKey: "sk-••••••••",
  enabled: true,
  created: "6/29/2026",
  expiry: "Never expires",
  models: "All",
  usage: "42,721,786,062 used tok · $75377.9003 used",
  dailyLimit: "No daily limit",
}));
