// Cheaper Inference: cost-ranked OpenAI-compatible gateway (#1164).
//
// Ported from OmniRoute open-sse/config/providers/registry/cheaperinference/index.ts
// and open-sse/executors/cheaperinference.ts (diegosouzapw/OmniRoute@61e07fb7, MIT).
// Upstream captured the catalog from a live GET /v1/models on 2026-07-31; the
// model list and capability flags are copied verbatim. Image models (served
// on /v1/images/generations) are not ported here.
//
// Chat and Responses live at different URLs, selected per model by the
// targetFormat tag through the transports below (no custom executor needed in
// this tree). The Responses endpoint is stateless and REQUIRES store:false:
// a missing or client-supplied store:true returns HTTP 400 upstream, so
// clampRequestBody forces it on Responses-shaped bodies only (Chat
// Completions rejects unknown params, so it never gets a store field).
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";

function forceStatelessResponses(body) {
  if (!body || !isObject(body)) return body;
  if (Array.isArray(body.input) || isString(body.input)) body.store = false;
  return body;
}

export default {
  id: "cheaperinference",
  alias: "cinf",
  uiAlias: "cinf",
  display: {
    name: "Cheaper Inference",
    icon: "savings",
    color: "#16A34A",
    textIcon: "CI",
    website: "https://cheaperinference.com",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.cheaperinference.com/v1/chat/completions",
    validateUrl: "https://api.cheaperinference.com/v1/models",
    clampRequestBody: forceStatelessResponses,
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.cheaperinference.com/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "openai-responses",
      baseUrl: "https://api.cheaperinference.com/v1/responses",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  models: [
  { id: "aion-labs.aion-2-0", name: "Aion 2.0", supportsReasoning: true, toolCalling: true },
  {
    id: "claude-fable-5",
    name: "Claude Fable 5",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
  },
  {
    id: "claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
  },
  {
    id: "claude-opus-4-7-fast",
    name: "Claude Opus 4.7 Fast",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
  },
  {
    id: "claude-opus-4-8-fast",
    name: "Claude Opus 4.8 Fast",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
  },
  {
    id: "claude-opus-4.5",
    name: "Claude Opus 4.5",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
  },
  {
    id: "claude-opus-4.6",
    name: "Claude Opus 4.6",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
  },
  {
    id: "claude-opus-4.7",
    name: "Claude Opus 4.7",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
  },
  {
    id: "claude-opus-4.8",
    name: "Claude Opus 4.8",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
  },
  {
    id: "claude-opus-5",
    name: "Claude Opus 5",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
  },
  {
    id: "claude-opus-5-fast",
    name: "Claude Opus 5 Fast",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
  },
  {
    id: "claude-sonnet-4.5",
    name: "Claude Sonnet 4.5",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
  },
  {
    id: "claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
  },
  {
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    supportsReasoning: true,
    toolCalling: true,
  },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", supportsReasoning: true, toolCalling: true },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
  },
  {
    id: "gemini-3.7-flash",
    name: "Gemini 3.7 Flash",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
  },
  {
    id: "gemini-3-flash-preview",
    name: "Gemini 3 Flash Preview",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
  },
  {
    id: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
  },
  {
    id: "gemini-3.1-pro",
    name: "Gemini 3.1 Pro",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
  },
  {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro Preview",
    supportsReasoning: true,
    toolCalling: true,
  },
  { id: "glm-4.5", name: "GLM-4.5", supportsReasoning: true, toolCalling: true },
  { id: "glm-4.5-air", name: "GLM-4.5 Air", supportsReasoning: true, toolCalling: true },
  { id: "glm-4.6", name: "GLM-4.6", supportsReasoning: true, toolCalling: true },
  { id: "glm-4.7", name: "GLM-4.7", supportsReasoning: true, toolCalling: true },
  { id: "glm-5", name: "GLM-5", supportsReasoning: true, toolCalling: true },
  { id: "glm-5.1", name: "GLM-5.1", supportsReasoning: true, toolCalling: true },
  { id: "glm-5.2", name: "GLM-5.2", supportsReasoning: true, toolCalling: true },
  {
    id: "google/gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash Lite",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
  },
  // The GPT-5.x family is tagged for the gateway's native /v1/responses endpoint —
  // that is the surface OpenAI-family clients (Codex-style) expect for tool loops.
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
    targetFormat: "openai-responses",
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
    targetFormat: "openai-responses",
  },
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
    targetFormat: "openai-responses",
  },
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
    targetFormat: "openai-responses",
  },
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
    targetFormat: "openai-responses",
  },
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
    targetFormat: "openai-responses",
  },
  {
    id: "grok-4.5",
    name: "Grok 4.5",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
  },
  {
    id: "kimi-k3",
    name: "Kimi K3",
    supportsVision: true,
    supportsReasoning: true,
    toolCalling: true,
  },
  { id: "minimax-m2.7", name: "MiniMax M2.7", supportsReasoning: true, toolCalling: true },
  ],
};
