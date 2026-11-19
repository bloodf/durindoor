/**
 * Single-endpoint probes for Ollama and OpenAI-compatible LAN discovery (#2025).
 */

import { guardedProbeFetch, OutboundUrlGuardError } from "open-sse/utils/outboundUrlGuard.js";
import { isString } from "@/shared/utils/typeChecks.js";

export const PROBE_TIMEOUT_MS = 1500;

/**
 * Build an http URL for a host:port path. IPv6 literals get brackets.
 * @param {string} host
 * @param {number} port
 * @param {string} path
 * @returns {string}
 */
export function buildProbeUrl(host, port, path) {
  const hostname = host.includes(":") ? `[${host}]` : host;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `http://${hostname}:${port}${normalizedPath}`;
}

/**
 * @param {string} host
 * @param {number} port
 * @returns {string}
 */
export function ollamaBaseUrl(host, port) {
  const hostname = host.includes(":") ? `[${host}]` : host;
  return `http://${hostname}:${port}`;
}

/**
 * OpenAI-compatible baseUrl always ends with /v1.
 * @param {string} host
 * @param {number} port
 * @returns {string}
 */
export function openaiCompatibleBaseUrl(host, port) {
  return `${ollamaBaseUrl(host, port)}/v1`;
}

/**
 * @param {unknown} json
 * @returns {string[]}
 */
export function extractOllamaModels(json) {
  const list = json && Array.isArray(json.models) ? json.models : [];
  return list.
  map((entry) => {
    if (isString(entry)) return entry;
    if (entry && isString(entry.name)) return entry.name;
    if (entry && isString(entry.model)) return entry.model;
    return null;
  }).
  filter(Boolean);
}

/**
 * @param {unknown} json
 * @returns {string[]}
 */
export function extractOpenAIModels(json) {
  const list = json && Array.isArray(json.data) ? json.data : [];
  return list.
  map((entry) => {
    if (isString(entry)) return entry;
    if (entry && isString(entry.id)) return entry.id;
    return null;
  }).
  filter(Boolean);
}

/**
 * Probe one kind at host:port. Guard blocks and timeouts yield null.
 *
 * @param {{ host: string, port: number, kind: "ollama"|"openai-compatible", fetchImpl?: typeof fetch, timeoutMs?: number }} options
 * @returns {Promise<{ baseUrl: string, host: string, port: number, kind: "ollama"|"openai-compatible", models: string[] }|null>}
 */
export async function probeEndpoint({
  host,
  port,
  kind,
  fetchImpl = fetch,
  timeoutMs = PROBE_TIMEOUT_MS,
}) {
  const path = kind === "ollama" ? "/api/tags" : "/v1/models";
  const url = buildProbeUrl(host, port, path);
  const baseUrl = kind === "ollama" ? ollamaBaseUrl(host, port) : openaiCompatibleBaseUrl(host, port);

  try {
    const response = await guardedProbeFetch(
      url,
      { method: "GET", signal: AbortSignal.timeout(timeoutMs) },
      undefined,
      fetchImpl
    );
    if (!response.ok) return null;
    let json = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    const models = kind === "ollama" ? extractOllamaModels(json) : extractOpenAIModels(json);
    return { baseUrl, host, port, kind, models };
  } catch (error) {
    if (error instanceof OutboundUrlGuardError) return null;
    // Timeouts, connection refused, DNS failures, etc. are non-candidates.
    return null;
  }
}
