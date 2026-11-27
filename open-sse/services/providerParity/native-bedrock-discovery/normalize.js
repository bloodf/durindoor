// Model-list normalization for the private Bedrock discovery helper (#2034).
//
// Ported from OmniRoute (MIT, Copyright (c) 2026 Cheaper Inference - Created by
// Diego Souza), commit 3a17f7e908308a217887a7617c2c793b95ea83c0,
// open-sse/config/bedrock.ts `normalizeBedrockDiscoveredModels` and `modelIdFromArn`.
//
// Deliberate differences from the source:
// - Rows are validated; a malformed list fails instead of being read as empty.
// - No token limits are attached (the source looked them up in its own model-spec table,
//   which DurinDoor does not carry) and no prices are produced.
// - `supportsStreaming` is reported only when AWS declares it. The source set it to `true`
//   for every inference profile and every ARN-derived model; here those stay `null`.
import { isObject, isString } from "../../../../src/shared/utils/typeChecks.js";

/** Bedrock model and inference-profile ids: vendor.model[:version], optional geo prefix. */
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const MAX_NAME_LENGTH = 256;

export class BedrockDiscoveryResponseError extends Error {
  constructor(message) {
    super(message);
    this.name = "BedrockDiscoveryResponseError";
  }
}

const record = (value) => (value && isObject(value) && !Array.isArray(value) ? value : null);

function validId(value) {
  if (!isString(value)) return null;
  const id = value.trim();
  return MODEL_ID_PATTERN.test(id) ? id : null;
}

function displayName(value, fallback) {
  if (!isString(value)) return fallback;
  const name = value.trim();
  return name && name.length <= MAX_NAME_LENGTH && !/[\u0000-\u001f]/.test(name) ? name : fallback;
}

function modalities(value) {
  return Array.isArray(value) ? value.filter(isString) : [];
}

/** Foundation model id from a `...:foundation-model/<id>` ARN, or null. */
export function modelIdFromArn(value) {
  if (!isString(value)) return null;
  const marker = ":foundation-model/";
  const index = value.indexOf(marker);
  if (index < 0) return null;
  return validId(value.slice(index + marker.length));
}

/**
 * Check a ListFoundationModels output and return its summaries.
 * @throws {BedrockDiscoveryResponseError} When the list is missing or holds a malformed row.
 */
export function validateFoundationModels(output) {
  const summaries = record(output)?.modelSummaries;
  if (!Array.isArray(summaries)) throw new BedrockDiscoveryResponseError("Bedrock returned no foundation model list");
  for (const row of summaries) {
    if (!record(row) || !validId(row.modelId)) {
      throw new BedrockDiscoveryResponseError("Bedrock returned a malformed foundation model row");
    }
  }
  return summaries;
}

/**
 * Check one ListInferenceProfiles page and return its summaries.
 * @throws {BedrockDiscoveryResponseError} When the page is missing or holds a malformed row.
 */
export function validateInferenceProfilePage(output) {
  const summaries = record(output)?.inferenceProfileSummaries;
  if (!Array.isArray(summaries)) throw new BedrockDiscoveryResponseError("Bedrock returned no inference profile list");
  for (const row of summaries) {
    if (!record(row) || !validId(row.inferenceProfileId)) {
      throw new BedrockDiscoveryResponseError("Bedrock returned a malformed inference profile row");
    }
    if (row.models !== undefined && !Array.isArray(row.models)) {
      throw new BedrockDiscoveryResponseError("Bedrock returned a malformed inference profile row");
    }
  }
  return summaries;
}

/**
 * Merge foundation models and inference profiles into one sorted, de-duplicated list.
 * Foundation rows win over the same id derived from a profile ARN.
 *
 * @param {object[]} foundation - Validated foundation summaries.
 * @param {object[]} profiles - Validated inference-profile summaries.
 * @returns {{ id: string, name: string, source: "foundation"|"inference_profile",
 *   provider: string|null, supportsStreaming: boolean|null, supportsVision: boolean|null }[]}
 */
export function normalizeBedrockDiscoveredModels(foundation, profiles = []) {
  const byId = new Map();
  const add = (model) => {
    if (!byId.has(model.id)) byId.set(model.id, Object.freeze(model));
  };

  for (const row of foundation) {
    const id = validId(row.modelId);
    const input = modalities(row.inputModalities);
    const output = modalities(row.outputModalities);
    add({
      id,
      name: displayName(row.modelName, id),
      source: "foundation",
      provider: isString(row.providerName) ? displayName(row.providerName, null) : null,
      supportsStreaming: typeof row.responseStreamingSupported === "boolean" ? row.responseStreamingSupported : null,
      supportsVision: input.length || output.length ? input.includes("IMAGE") || output.includes("IMAGE") : null,
    });
  }

  for (const profile of profiles) {
    const id = validId(profile.inferenceProfileId);
    add({
      id,
      name: displayName(profile.inferenceProfileName, id),
      source: "inference_profile",
      provider: null,
      supportsStreaming: null,
      supportsVision: null,
    });
    for (const member of Array.isArray(profile.models) ? profile.models : []) {
      const memberId = modelIdFromArn(record(member)?.modelArn);
      if (!memberId) continue;
      add({
        id: memberId,
        name: memberId,
        source: "foundation",
        provider: null,
        supportsStreaming: null,
        supportsVision: null,
      });
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
