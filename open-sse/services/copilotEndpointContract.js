/**
 * Copilot endpoint contract.
 *
 * Copilot's live model catalog can advertise which endpoints serve a model:
 * `supported_endpoints` at the top level, or the same list nested under
 * `capabilities`. Upstream OmniRoute #15337 normalized that metadata and used
 * it to pick the existing Responses route for models Copilot serves only
 * there; #15499 applied the same contract to GitHub Enterprise Copilot's
 * GPT-6 family.
 *
 * This module owns the normalization and the route decision so the catalog
 * layer (discovery) and the executor layer (dispatch) share one definition.
 * It is pure: no I/O, no provider state, no network.
 *
 * Endpoint kinds name the routes this fork already has for Copilot:
 *   - "chat"      → /chat/completions
 *   - "responses" → /responses
 *
 * "messages" folds into "chat": Copilot advertises its Anthropic-native
 * /v1/messages shim that way, and a model that speaks Messages is not a
 * Responses-only model. Claude models keep their own Messages route, which
 * the executor decides by model name before this contract is consulted.
 */

import crypto from "crypto";
import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";

export const COPILOT_ENDPOINT_CONTRACT_VERSION = 1;

export const COPILOT_ENDPOINT_CHAT = "chat";
export const COPILOT_ENDPOINT_RESPONSES = "responses";

/**
 * Generation of an account that carries no routing metadata at all.
 *
 * "No contract" is a state, not a missing value: an account that never ran
 * discovery and an account whose contract was cleared both read as this
 * generation, so a learned route survives neither the appearance nor the
 * disappearance of a contract.
 */
export const COPILOT_ROUTE_GENERATION_ABSENT = "absent";

/** Declared endpoint paths that mean "the chat route serves this model". */
const CHAT_PATHS = new Set(["chat/completions", "chat-completions", "messages"]);

/**
 * Trim a declared endpoint and fold it into its catalog path form:
 * "/v1/responses/" → "responses", "/chat/completions" → "chat/completions".
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeEndpointPath(value) {
  if (!isString(value)) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/^v1\//, "")
    .replace(/\/$/, "");
}

/**
 * Endpoint kinds a catalog row declares.
 *
 * An already-normalized `supportedEndpoints` list wins over the raw forms;
 * a top-level `supported_endpoints` list wins over the nested one, so a row
 * that states both is read the way the provider states it first.
 *
 * @param {unknown} row - a raw catalog row or a normalized model row
 * @returns {string[]} sorted, de-duplicated endpoint kinds
 */
export function readCopilotEndpointKinds(row) {
  if (!isRecord(row)) return [];
  const capabilities = isRecord(row.capabilities) ? row.capabilities : {};
  const declared = Array.isArray(row.supportedEndpoints) ? row.supportedEndpoints :
    Array.isArray(row.supported_endpoints) ? row.supported_endpoints :
      Array.isArray(capabilities.supported_endpoints) ? capabilities.supported_endpoints : [];
  const kinds = new Set();
  for (const entry of declared) {
    const path = normalizeEndpointPath(entry);
    if (!path) continue;
    kinds.add(CHAT_PATHS.has(path) ? COPILOT_ENDPOINT_CHAT : path);
  }
  return [...kinds].sort();
}

/**
 * Endpoint contract for one catalog row.
 *
 * Copilot's own endpoint contract — not the model's version — decides the
 * route. A model that declares Responses and no chat endpoint is served by
 * /responses. Claude and Gemini models are excluded from that promotion
 * because Copilot's Responses endpoint does not serve them.
 *
 * @param {unknown} row - a raw catalog row or a normalized model row
 * @param {string} modelId
 * @returns {{ supportedEndpoints: string[], targetFormat?: "openai-responses" }}
 */
export function readCopilotEndpointContract(row, modelId) {
  const supportedEndpoints = readCopilotEndpointKinds(row);
  if (!supportedEndpoints.length) return {};
  const responsesOnly =
    supportedEndpoints.includes(COPILOT_ENDPOINT_RESPONSES) &&
    !supportedEndpoints.includes(COPILOT_ENDPOINT_CHAT) &&
    !/claude|gemini/i.test(modelId || "");
  const contract = { supportedEndpoints };
  if (responsesOnly) contract.targetFormat = "openai-responses";
  return contract;
}

/**
 * Endpoint contract for a whole discovered catalog.
 *
 * The model list is an array on purpose: a refreshed catalog then REPLACES the
 * stored one instead of deep-merging into it, so a model Copilot stopped
 * serving does not keep a stale route.
 *
 * @param {object[]} rows - raw catalog rows or normalized model rows
 * @returns {{ version: number, models: { id: string, supportedEndpoints: string[], targetFormat?: string }[] }}
 */
export function buildCopilotEndpointContract(rows) {
  const models = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isRecord(row)) continue;
    const id = isString(row.id) ? row.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const contract = readCopilotEndpointContract(row, id);
    if (!contract.supportedEndpoints?.length) continue;
    models.push({ id, ...contract });
  }
  return { version: COPILOT_ENDPOINT_CONTRACT_VERSION, models };
}

/**
 * The stored contract entry for one model, or null when the contract says
 * nothing about it.
 * @param {unknown} contract
 * @param {string} modelId
 */
export function getCopilotEndpointEntry(contract, modelId) {
  if (!isRecord(contract) || !Array.isArray(contract.models) || !isString(modelId)) return null;
  const id = modelId.trim();
  return contract.models.find((entry) => isRecord(entry) && entry.id === id) || null;
}

/**
 * The route a model uses, given the discovered contract.
 *
 * "responses" → the existing /responses route, "chat" → the existing
 * /chat/completions route, null → no usable metadata, so the caller keeps
 * its current fallback (chat first, escalated only on the provider's own
 * "not accessible via the /chat/completions endpoint" error).
 *
 * @param {unknown} contract
 * @param {string} modelId
 * @returns {"responses"|"chat"|null}
 */
export function resolveCopilotEndpointRoute(contract, modelId) {
  const entry = getCopilotEndpointEntry(contract, modelId);
  if (!entry) return null;
  const kinds = Array.isArray(entry.supportedEndpoints) ? entry.supportedEndpoints : [];
  if (!kinds.length) return null;
  if (entry.targetFormat === "openai-responses" && kinds.includes(COPILOT_ENDPOINT_RESPONSES)) {
    return COPILOT_ENDPOINT_RESPONSES;
  }
  return COPILOT_ENDPOINT_CHAT;
}

/**
 * Canonical form of a contract: the routing facts only, in a stable order.
 *
 * Two contracts that state the same routes produce the same form, so a
 * catalog refresh that reorders its rows is not a new generation. Only the
 * routes themselves (and the contract version) are kept — nothing secret
 * ever reaches this fingerprint.
 *
 * @param {unknown} contract
 * @returns {{ version: unknown, models: { id: string, supportedEndpoints: string[], targetFormat: string|null }[] }|null}
 */
function canonicalCopilotContract(contract) {
  if (!isRecord(contract) || !Array.isArray(contract.models)) return null;
  const models = [];
  for (const entry of contract.models) {
    if (!isRecord(entry)) continue;
    const endpoints = Array.isArray(entry.supportedEndpoints) ? entry.supportedEndpoints : [];
    models.push({
      id: isString(entry.id) ? entry.id.trim() : "",
      supportedEndpoints: endpoints.filter(isString).map((value) => value.trim()).sort(),
      targetFormat: isString(entry.targetFormat) ? entry.targetFormat : null,
    });
  }
  models.sort((left, right) => left.id.localeCompare(right.id));
  return { version: contract.version ?? null, models };
}

/**
 * Generation of one account's routing metadata.
 *
 * The generation answers "is the routing metadata the executor sees now the
 * same metadata the learned routes were learned under?". It is derived from
 * the discovered contract only — the catalog's own endpoint statements — so
 * it carries no account, host or token material.
 *
 * - A contract is present and readable → a content fingerprint. A refreshed
 *   catalog that changed the routes produces a different generation, which
 *   expires the learned routes learned under the old one.
 * - No contract at all → {@link COPILOT_ROUTE_GENERATION_ABSENT}. That is a
 *   real generation, not a missing value: a learned route stays valid until
 *   routing metadata appears, and dies again when it disappears.
 * - A contract that is present but not readable (not an object, no model
 *   list) → null. No trustworthy generation is available, so the caller must
 *   not trust a learned route against it.
 *
 * @param {unknown} contract - the stored Copilot endpoint contract
 * @returns {string|null} the generation, or null when it cannot be trusted
 */
export function computeCopilotRouteGeneration(contract) {
  if (contract === null || contract === undefined) return COPILOT_ROUTE_GENERATION_ABSENT;
  const canonical = canonicalCopilotContract(contract);
  if (!canonical) return null;
  const digest = crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 16);
  return `v${canonical.version ?? 0}:${digest}`;
}
