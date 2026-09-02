import { useState } from "react";

/**
 * ProviderLogo — renders the real provider logo from `public/providers/`
 * (served as `/providers/<id>.svg|png` in both the app and Storybook).
 *
 * Resolution: alias map → try `<id>.svg` → `<id>.png` → neutral letter tile.
 * Letter tile uses dd-* tokens so it flips with the theme.
 *
 * Props:
 * - provider: provider id or alias (case-insensitive), e.g. "cc", "codex", "claude"
 * - size: px box size (default 28)
 * - className: extra classes
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

const EXTS = ["svg", "png"];

export function ProviderLogo({ provider, size = 28, className = "" }) {
  const [stage, setStage] = useState(0);
  const raw = String(provider || "").trim().toLowerCase();
  const id = ALIASES[raw] || raw;

  if (!id || stage >= EXTS.length) {
    return (
      <span
        aria-label={id || "unknown provider"}
        className={`inline-flex shrink-0 items-center justify-center rounded-dd bg-dd-surface-3 text-dd-muted font-semibold select-none ${className}`}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      >
        {(id[0] || "?").toUpperCase()}
      </span>
    );
  }

  const src = `/providers/${id}.${EXTS[stage]}`;
  // Plain <img> required: this component must render in Storybook (no Next
  // image loader); when adopted into the app, keep <img> — provider logos are
  // tiny local static assets where next/image optimization buys nothing.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={src}
      src={src}
      alt={id}
      width={size}
      height={size}
      loading="lazy"
      className={`shrink-0 rounded-dd object-contain ${className}`}
      style={{ width: size, height: size }}
      onError={() => setStage((s) => s + 1)}
    />
  );
}

export default ProviderLogo;
