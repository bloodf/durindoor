import { useState } from "react";

/**
 * ProviderLogo — renders known local provider marks from `public/providers/`.
 * Unknown ids use a token-styled letter tile without issuing a failed request.
 */
const ALIASES = {
  cc: "claude",
  "claude-code": "claude",
  anthropic: "claude",
  cx: "codex",
  "openai-codex": "codex",
  codexcli: "codex",
  grok: "xai",
  "xai-grok": "xai",
  "kimi-coding": "kimi-coding",
  "kimi-coding-apikey": "kimi-coding-apikey",
  ollama: "ollama-local",
  minimax: "minimax",
  "minimax-cn": "minimax-cn",
  voyage: "voyage-ai",
  jina: "jina-ai",
  kilo: "kilocode",
  "kilo-code": "kilocode",
  droid: "droid",
  "factory-droid": "factory",
  deepseek: "deepseek",
  "deepseek-tui": "deepseek-tui",
  duckduckgo: "duckduckgo-web",
  mimo: "mimo-free",
  mimocode: "mimo-free",
  cloudflare: "cloudflare-ai",
  veo: "veoaifree-web",
  auggie: "auggie",
  augment: "auggie",
  chipotle: "chipotle",
  "github-copilot": "copilot",
};

// Local asset availability; provider metadata is not imported (it starts runtime services).
const MARKS = {
  "360ai": "svg", "adapta-web": "png", "agentrouter": "png", "aihorde": "png",
  "aimlapi": "png", "alibaba-cn": "png", "alicode": "png", "alicode-intl": "png",
  "amp": "png", "anthropic": "svg", "anthropic-m": "png", "antigravity": "png",
  "api-airforce": "svg", "apikey": "svg", "arcee-ai": "svg", "assemblyai": "svg",
  "auggie": "svg", "aws-polly": "png", "azure": "svg", "baichuan": "svg",
  "baidu": "svg", "bazaarlink": "svg", "black-forest-labs": "png", "blackbox": "png",
  "blackbox-web": "png", "bluesminds": "svg", "brave": "svg", "brave-search": "svg",
  "byteplus": "svg", "bytez": "svg", "cartesia": "svg", "cerebras": "svg",
  "charm-hyper": "svg", "chipotle": "svg", "chutes": "svg", "clarifai": "svg",
  "claude": "svg", "claude-web": "svg", "cline": "svg", "clinepass": "png",
  "cliproxyapi": "png", "cloudflare-ai": "png", "codebuddy-cn": "png", "codex": "svg",
  "cohere": "svg", "comfyui": "svg", "command-code": "svg", "commandcode": "png",
  "continue": "svg", "copilot": "svg", "coqui": "png", "coze": "svg",
  "crof": "svg", "cursor": "svg", "deepgram": "svg", "deepseek": "svg",
  "deepseek-tui": "png", "dgrid": "svg", "dify": "svg", "digitalocean": "svg",
  "dit": "svg", "docker-model-runner": "svg", "doubao": "svg", "droid": "svg",
  "duckduckgo-web": "svg", "edge-tts": "png", "elevenlabs": "svg", "empower": "png",
  "exa": "svg", "factory": "svg", "fal-ai": "png", "firecrawl": "png",
  "fireworks": "svg", "freeaiapikey": "svg", "freemodel-dev": "svg", "galadriel": "svg",
  "gemini": "svg", "gemini-cli": "png", "gigachat": "png", "github": "png",
  "github-models": "png", "gitlab": "svg", "gitlab-duo": "svg", "gitlawb": "svg",
  "gitlawb-gmi": "svg", "glm": "png", "glm-cn": "png", "glmt": "png",
  "google-pse": "png", "google-tts": "png", "grok-web": "png", "groq": "svg",
  "hackclub": "svg", "haiper": "svg", "hcnsec": "svg", "hermes": "png",
  "heroku": "png", "huggingchat": "svg", "huggingface": "svg", "hyperbolic": "svg",
  "ideogram": "svg", "iflow": "png", "iflytek": "svg", "inclusionai": "svg",
  "inner-ai": "png", "inworld": "svg", "ironclaw": "png", "jcode": "png",
  "jina-ai": "png", "jina-reader": "png", "kenari": "svg", "kie": "png",
  "kilo-gateway": "svg", "kilocode": "svg", "kimchi": "svg", "kimi": "svg",
  "kimi-coding": "png", "kimi-coding-apikey": "png", "kiro": "svg", "krutrim": "svg",
  "lemonade": "png", "leonardo": "svg", "linkup": "png", "linkup-search": "png",
  "liquid": "svg", "llamafile": "png", "llamagate": "png", "llm7": "svg",
  "local-device": "png", "maritalk": "png", "mimo-free": "png", "minimax": "svg",
  "minimax-cn": "png", "mistral": "svg", "modal": "svg", "modelscope": "svg",
  "monsterapi": "svg", "nanobanana": "png", "nanobot": "png", "nanogpt": "png",
  "nebius": "svg", "nlpcloud": "svg", "nomic": "svg", "nscale": "png",
  "nube": "svg", "nvidia": "svg", "oai-cc": "png", "oai-r": "png",
  "oauth": "svg", "oci": "svg", "oh-my-pi": "svg", "ollama": "svg",
  "ollama-local": "png", "openadapter": "svg", "openai": "svg", "openclaw": "svg",
  "opencode": "svg", "opencode-dark": "svg", "opencode-go": "png", "opencode-light": "svg",
  "openrouter": "svg", "orcarouter": "svg", "ovhcloud": "png", "perplexity": "svg",
  "perplexity-web": "png", "phind": "svg", "piapi": "png", "picoclaw": "jpg",
  "pioneer": "svg", "playht": "svg", "poolside": "svg", "predibase": "png",
  "publicai": "svg", "puter": "svg", "qianfan": "svg", "qiniu": "svg",
  "qoder": "png", "qwen": "svg", "recraft": "svg", "reka": "png",
  "requesty": "svg", "roo": "png", "runwayml": "png", "sap": "svg",
  "scaleway": "svg", "sdwebui": "png", "searchapi": "svg", "searxng": "png",
  "searxng-search": "svg", "sensenova": "svg", "serper": "png", "serper-search": "svg",
  "siliconflow": "png", "sparkdesk": "svg", "stability-ai": "png", "stepfun": "svg",
  "sumopod": "svg", "synthetic": "svg", "t3-web": "svg", "tavily": "svg",
  "tencent": "svg", "theoldllm": "svg", "together": "png", "tokenrouter": "svg",
  "topaz": "png", "tortoise": "png", "uncloseai": "svg", "veoaifree-web": "svg",
  "vertex": "png", "vertex-partner": "png", "volcengine-ark": "png", "voyage-ai": "png",
  "wafer": "svg", "wandb": "svg", "x5lab": "svg", "xai": "svg",
  "xiaomi-mimo": "png", "xiaomi-tokenplan": "png", "yi": "svg", "youcom": "png",
  "youcom-search": "svg", "yuanbao-web": "svg", "zed-hosted": "svg", "zenmux": "svg",
  "zenmux-free": "svg", "zeroclaw": "png",
};

export function ProviderLogo({ provider, fallbackText, size = 28, className = "" }) {
  const [failedId, setFailedId] = useState(null);
  const raw = String(provider || "").trim().toLowerCase();
  const id = ALIASES[raw] || raw;
  const ext = MARKS[id];

  if (!ext || failedId === id) {
    // The tile is a fixed square, so an arbitrary-length fallback (a full
    // provider id like "9router") overflows it and axe then reports the text as
    // partially obscured with an indeterminate background. Render the single
    // initial the DS contract expects, with the full name left to assistive tech.
    const glyph = ((fallbackText || id || "?")[0] || "?").toUpperCase();
    return (
      <span
        role="img"
        aria-label={fallbackText || id || "unknown provider"}
        className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-dd bg-dd-surface-3 text-dd-muted font-semibold select-none ${className}`}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      >
        {glyph}
      </span>
    );
  }

  const src = `/providers/${id}.${ext}`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={id}
      width={size}
      height={size}
      loading="lazy"
      className={`shrink-0 rounded-dd object-contain ${className}`}
      style={{ width: size, height: size }}
      onError={() => setFailedId(id)}
    />
  );
}

export default ProviderLogo;
