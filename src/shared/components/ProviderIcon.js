"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";

const KNOWN_SVGS = new Set([
  "anthropic",
  "assemblyai",
  "azure",
  "brave-search",
  "cartesia",
  "cerebras",
  "claude",
  "cline",
  "codex",
  "cohere",
  "comfyui",
  "continue",
  "copilot",
  "cursor",
  "deepgram",
  "deepseek",
  "droid",
  "elevenlabs",
  "exa",
  "fireworks",
  "gemini",
  "groq",
  "huggingface",
  "hyperbolic",
  "inworld",
  "kilocode",
  "kimchi",
  "kimi",
  "kiro",
  "minimax",
  "mistral",
  "nebius",
  "nvidia",
  "ollama",
  "openai",
  "openclaw",
  "opencode",
  "openrouter",
  "perplexity",
  "playht",
  "qwen",
  "recraft",
  "searchapi",
  "tavily",
  "xai",
]);

export default function ProviderIcon({
  src,
  alt,
  size = 32,
  className = "",
  fallbackText = "?",
  fallbackColor,
}) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    setStage(0);
  }, [src]);

  const candidates = [src];
  const pngMatch = typeof src === "string" && src.match(/^\/providers\/([^/]+)\.png$/i);
  if (pngMatch && KNOWN_SVGS.has(pngMatch[1])) {
    candidates.unshift(`/providers/${pngMatch[1]}.svg`);
  }

  if (stage >= candidates.length || !src) {
    return (
      <span
        className={`inline-flex items-center justify-center font-bold rounded-lg ${className}`.trim()}
        style={{
          width: size,
          height: size,
          color: fallbackColor,
          fontSize: Math.max(10, Math.floor(size * 0.38)),
        }}
      >
        {fallbackText}
      </span>
    );
  }

  return (
    <img
      src={candidates[stage]}
      alt={alt}
      width={size}
      height={size}
      className={className}
      onError={() => setStage(s => s + 1)}
    />
  );
}

ProviderIcon.propTypes = {
  src: PropTypes.string,
  alt: PropTypes.string,
  size: PropTypes.number,
  className: PropTypes.string,
  fallbackText: PropTypes.string,
  fallbackColor: PropTypes.string,
};
