import ProviderLogo from "./ProviderLogo.jsx";

/**
 * Real provider logos served from /providers/*.svg|png with a token-styled
 * letter-tile fallback when no asset exists.
 */
const meta = {
  title: "Durin DS/Surfaces/ProviderLogo",
  component: ProviderLogo,
  parameters: { layout: "padded" },
};
export default meta;

const KNOWN = [
  "claude", "codex", "cursor", "xai", "kimi", "minimax", "ollama-local",
  "openai", "gemini", "mistral", "copilot", "cline", "continue", "nvidia",
  "voyage-ai", "together", "fireworks", "jina-ai", "nebius", "openrouter",
  "github", "kiro", "antigravity", "qwen", "deepseek", "amp", "roo",
  "kilocode", "droid", "factory", "auggie", "chipotle", "duckduckgo-web",
  "mimo-free", "cloudflare-ai", "anthropic-m", "gemini-cli", "grok-web",
];

export function Grid() {
  return (
    <div className="grid grid-cols-6 gap-4">
      {KNOWN.map((p) => (
        <div key={p} className="flex flex-col items-center gap-1.5">
          <ProviderLogo provider={p} size={32} />
          <span className="text-[10px] text-dd-muted">{p}</span>
        </div>
      ))}
    </div>
  );
}

export function AliasesAndFallback() {
  return (
    <div className="flex items-center gap-4">
      <ProviderLogo provider="cc" size={32} />
      <ProviderLogo provider="cx" size={32} />
      <ProviderLogo provider="ollama" size={32} />
      <ProviderLogo provider="totally-unknown-provider" size={32} />
      <span className="text-xs text-dd-muted">cc → claude, cx → codex, ollama → ollama-local, unknown → letter tile</span>
    </div>
  );
}

export function Sizes() {
  return (
    <div className="flex items-end gap-4">
      {[20, 24, 28, 32, 40].map((s) => (
        <ProviderLogo key={s} provider="claude" size={s} />
      ))}
    </div>
  );
}
