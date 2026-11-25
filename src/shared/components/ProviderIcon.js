"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { isString } from "../utils/typeChecks.js";

const KNOWN_SVGS = new Set([
"anthropic",
"api-airforce",
"assemblyai",
"auggie",
"azure",
"bluesminds",
"brave-search",
"byteplus",
"bytez",
"cartesia",
"cerebras",
"charm-hyper",
"chipotle",
"chutes",
"claude",
"cline",
"codex",
"cohere",
"comfyui",
"continue",
"copilot",
"crof",
"cursor",
"deepgram",
"deepseek",
"devin-desktop",
"dgrid",
"digitalocean",
"dit",
"droid",
"duckduckgo-web",
"elevenlabs",
"exa",
"factory",
"fireworks",
"freeaiapikey",
"freebuff",
"freemodel-dev",
"galadriel",
"gemini",
"gitlawb",
"groq",
"hackclub",
"haiper",
"hcnsec",
"huggingface",
"hyperbolic",
"ideogram",
"inworld",
"kenari",
"kilocode",
"kimchi",
"kimi",
"kiro",
"leonardo",
"llm7",
"minimax",
"mistral",
"modelscope",
"nebius",
"nube",
"nvidia",
"ollama",
"openadapter",
"openai",
"openclaw",
"opencode",
"openrouter",
"orcarouter",
"perplexity",
"pioneer",
"playht",
"publicai",
"qiniu",
"qwen",
"recraft",
"requesty",
"searchapi",
"sumopod",
"t3-web",
"tavily",
"theoldllm",
"tokenrouter",
"uncloseai",
"veoaifree-web",
"wafer",
"workbuddy",
"x5lab",
"xai",
"yuanbao-web",
"zed-hosted",
"zenmux",
"zenmux-free"]
);

// Compatible nodes can supply a generic image after their node-specific icon fails.
export default function ProviderIcon({
  src,
  alt,
  size = 32,
  className = "",
  fallbackText = "?",
  fallbackColor,
  fallbackSrc
}) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    setStage(0);
  }, [src, fallbackSrc]);

  const candidates = [src];
  if (src === "/providers/cursor-api.png") candidates.unshift("/providers/cursor.svg");
  const pngMatch = isString(src) && src.match(/^\/providers\/([^/]+)\.png$/i);
  if (pngMatch && KNOWN_SVGS.has(pngMatch[1])) {
    candidates.unshift(`/providers/${pngMatch[1]}.svg`);
  }

  if (fallbackSrc && fallbackSrc !== src) candidates.push(fallbackSrc);

  if (stage >= candidates.length || !candidates[stage]) {
    return (
      <span
        role="img"
        aria-label={alt || fallbackText}
        className={`inline-flex shrink-0 items-center justify-center rounded-dd bg-dd-surface-3 font-semibold text-dd-muted select-none ${className}`.trim()}
        style={{
          width: size,
          height: size,
          color: fallbackColor || undefined,
          fontSize: Math.max(10, Math.floor(size * 0.38)),
        }}
      >
        {fallbackText}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={candidates[stage].startsWith("/providers/") ? `${process.env.NEXT_PUBLIC_BASE_PATH || ""}${candidates[stage]}` : candidates[stage]}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-dd object-contain ${className}`.trim()}
      onError={() => setStage((s) => s + 1)}
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
  fallbackSrc: PropTypes.string
};