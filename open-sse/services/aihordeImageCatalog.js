// AI Horde public image-model catalog (#2034). STAGED: only the staged image
// adapter (open-sse/handlers/imageProviders/aihorde.js) imports it, and that
// adapter is not in IMAGE_ADAPTERS. See internal/docs/aihorde-images-2034.md.
//
// Ported from cheaper-inference/OmniRoute at
// c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT, Copyright (c) 2026 Cheaper
// Inference - Created by Diego Souza): open-sse/services/aihordeImageCatalog.ts.
//
// Kept from the source: `GET https://aihorde.net/api/v2/status/models?type=image`,
// only rows with `count > 0`, exact Horde model names, a 30 s freshness window,
// a 15 s fetch bound, one shared in-flight refresh, and a failed refresh keeping
// the last successful snapshot while recording `lastError`.
//
// Fork deviations: no background-refresh feature flag and no dynamic model
// source registration (every refresh blocks its caller); the shared refresh owns
// its own deadline, so one caller's abort ends only that caller's wait; the
// payload read is byte-bounded; `lastError` is a fixed short message, never a
// raw transport error. The catalog is public and anonymous: it never takes,
// sends or stores a credential.
import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";

export const AI_HORDE_API_BASE = "https://aihorde.net/api";
export const AI_HORDE_ANONYMOUS_KEY = "0000000000";
// AI Horde asks clients to identify as `name:version:contact`.
export const AI_HORDE_CLIENT_AGENT = "DurinDoor:staged:https://github.com/bloodf/durindoor";
export const AI_HORDE_CATALOG_URL = `${AI_HORDE_API_BASE}/v2/status/models?type=image`;
export const AI_HORDE_CATALOG_POLL_MS = 30_000;
export const AI_HORDE_CATALOG_FETCH_TIMEOUT_MS = 15_000;
export const AI_HORDE_CATALOG_MAX_BYTES = 4 * 1024 * 1024;

const abortError = (signal) => signal?.reason instanceof Error
  ? signal.reason
  : Object.assign(new Error("The operation was aborted"), { name: "AbortError" });

/**
 * Read at most `maxBytes` of a response body. Returns null when the body is
 * larger (the stream is cancelled) or unreadable.
 */
export async function readBoundedBody(response, maxBytes) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel?.().catch(() => {});
    return null;
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

/** Bounded JSON read; null when the body is too large, unreadable or not JSON. */
export async function readBoundedJson(response, maxBytes) {
  const bytes = await readBoundedBody(response, maxBytes);
  if (!bytes || bytes.length === 0) return null;
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
}

function asNumber(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asInt(value) {
  const parsed = asNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

/**
 * Keep image models that currently have at least one worker.
 * @throws {Error} when the payload is not a JSON array
 */
export function parseHordeImageModels(payload) {
  if (!Array.isArray(payload)) throw new Error("Horde model catalog must be a JSON array");
  const models = [];
  for (const row of payload) {
    if (!isRecord(row)) continue;
    const { name } = row;
    if (!isString(name) || !name.trim()) continue;
    const type = row.type ?? "image";
    if (type !== null && type !== "image") continue;
    const count = asInt(row.count ?? 0) ?? 0;
    if (count <= 0) continue;
    models.push({
      name,
      count,
      queued: asNumber(row.queued),
      eta: asInt(row.eta),
      performance: asNumber(row.performance),
      jobs: asNumber(row.jobs),
    });
  }
  return models.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

// Fixed public origin, so no SSRF host policy applies; a redirect is refused
// rather than followed.
const defaultTransport = (url, init) => fetch(url, { ...init, redirect: "manual" });

export class HordeImageCatalog {
  #models = new Map();
  #updatedAt = null;
  #lastError = null;
  #inflight = null;
  #transport;
  #now;

  /**
   * @param {object} [options]
   * @param {number} [options.pollMs] - freshness window, at least 5 s
   * @param {number} [options.fetchTimeoutMs] - bound of one shared refresh
   * @param {(url: string, init: RequestInit) => Promise<Response>} [options.transport]
   * @param {() => number} [options.now]
   */
  constructor({ pollMs = AI_HORDE_CATALOG_POLL_MS, fetchTimeoutMs = AI_HORDE_CATALOG_FETCH_TIMEOUT_MS, transport = defaultTransport, now = Date.now } = {}) {
    this.pollMs = Math.max(5_000, pollMs);
    this.fetchTimeoutMs = fetchTimeoutMs;
    this.#transport = transport;
    this.#now = now;
  }

  get snapshot() {
    return { models: this.listModels(), updatedAt: this.#updatedAt, lastError: this.#lastError };
  }

  get stale() {
    return this.#lastError !== null && this.#updatedAt !== null;
  }

  listModels() {
    return [...this.#models.values()]
      .map((model) => ({ ...model }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  get(name) {
    const model = this.#models.get(name);
    return model ? { ...model } : undefined;
  }

  isServed(name) {
    return (this.#models.get(name)?.count ?? 0) > 0;
  }

  hasSnapshot() {
    return this.#updatedAt !== null;
  }

  /** Drop the snapshot so the next `ensureFresh` must reach Horde. */
  clear() {
    this.#models = new Map();
    this.#updatedAt = null;
    this.#lastError = null;
  }

  /**
   * Wait until the snapshot is younger than `maxAgeMs` and error-free, joining
   * the shared refresh if one is running. `signal` ends this caller's wait only.
   */
  async ensureFresh(maxAgeMs = this.pollMs, { signal } = {}) {
    if (this.#updatedAt !== null && this.#now() - this.#updatedAt < maxAgeMs && this.#lastError === null) return;
    await this.refresh({ signal });
  }

  /** Join or start the one shared refresh. Never rejects except on this caller's abort. */
  refresh({ signal } = {}) {
    if (signal?.aborted) return Promise.reject(abortError(signal));
    if (this.#inflight === null) {
      this.#inflight = this.#refreshOnce().finally(() => { this.#inflight = null; });
    }
    if (!signal) return this.#inflight;
    const shared = this.#inflight;
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(abortError(signal));
      signal.addEventListener("abort", onAbort, { once: true });
      shared.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
  }

  async #refreshOnce() {
    const timeout = AbortSignal.timeout(this.fetchTimeoutMs);
    try {
      const response = await this.#transport(AI_HORDE_CATALOG_URL, {
        method: "GET",
        headers: { Accept: "application/json", "Client-Agent": AI_HORDE_CLIENT_AGENT },
        signal: timeout,
      });
      if (response.status !== 200) {
        await response.body?.cancel?.().catch(() => {});
        throw new Error(`Horde catalog HTTP ${response.status}`);
      }
      const payload = await Promise.race([
        readBoundedJson(response, AI_HORDE_CATALOG_MAX_BYTES),
        new Promise((_, reject) => {
          if (timeout.aborted) reject(new Error("Horde catalog timed out"));
          timeout.addEventListener("abort", () => reject(new Error("Horde catalog timed out")), { once: true });
        }),
      ]);
      if (payload === null) throw new Error("Horde catalog returned an unreadable payload");
      const models = parseHordeImageModels(payload);
      this.#models = new Map(models.map((model) => [model.name, model]));
      this.#updatedAt = this.#now();
      this.#lastError = null;
    } catch (error) {
      // Keep the last successful snapshot; record a fixed message only.
      const message = error?.message;
      this.#lastError = timeout.aborted ? "Horde catalog timed out" :
        /^Horde catalog /.test(message ?? "") ? message :
          message === "Horde model catalog must be a JSON array" ? message : "Horde catalog request failed";
    }
  }
}

export const aiHordeImageCatalog = new HordeImageCatalog();
