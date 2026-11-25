import {
  createCombo,
  updateCombo,
  deleteCombo,
  getComboById,
  getComboByName,
  ComboMemberError,
  validateConnectionIds,
  ConnectionGroupValidationError
} from "@/lib/localDb";
import { resetComboRotation, resetComboScoring } from "open-sse/services/combo.js";
import { normalizeComboCapabilities } from "open-sse/providers/capabilities.js";
import { normalizeComboModelId } from "./modelIds.js";

import { isBoolean } from "@/shared/utils/typeChecks.js";

const MAX_ALLOWLIST_IDS = 500;

// Validate combo name: only a-z, A-Z, 0-9, -, _ and .
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

/**
 * Combo validation / not-found failure carrying the HTTP status the REST
 * routes and the MCP control tools both map onto their own error shape.
 */
export class ComboManagementError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ComboManagementError";
    this.status = status;
  }
}

function validateNoLog(body) {
  if (Object.hasOwn(body, "noLog") && !isBoolean(body.noLog)) {
    throw new ComboManagementError("noLog must be a boolean");
  }
}

async function parseAllowedConnectionIds(body) {
  if (!Object.prototype.hasOwnProperty.call(body, "allowedConnectionIds")) return undefined;
  if (!Array.isArray(body.allowedConnectionIds) || body.allowedConnectionIds.length > MAX_ALLOWLIST_IDS) {
    throw new ComboManagementError(`allowedConnectionIds must be an array with at most ${MAX_ALLOWLIST_IDS} ids`);
  }
  return await validateConnectionIds(body.allowedConnectionIds);
}

/** Member/allowlist validation errors are caller mistakes, not server faults. */
function asManagementError(error) {
  if (error instanceof ComboManagementError) return error;
  if (error instanceof ComboMemberError || error instanceof ConnectionGroupValidationError) {
    return new ComboManagementError(error.message, 400);
  }
  return null;
}

function assertValidName(name) {
  if (!VALID_NAME_REGEX.test(name)) {
    throw new ComboManagementError("Name can only contain letters, numbers, -, _ and .");
  }
}

async function assertNameAvailable(name, excludeId) {
  const existing = await getComboByName(name);
  // The stored id and the caller's id can differ in type (route string vs number).
  if (existing && String(existing.id) !== String(excludeId)) {
    throw new ComboManagementError("Combo name already exists");
  }
}

/**
 * Normalize `models`, and `members[].id` with it so weights still match.
 * A non-array `models` is left for the repository to reject.
 */
function normalizeTargets(models, members) {
  if (!Array.isArray(models)) return { models, members };
  const ids = models.map(normalizeComboModelId);
  if (ids.includes(null)) throw new ComboManagementError("Models must contain valid model IDs");
  return {
    models: ids,
    members: Array.isArray(members)
      ? members.map((member) => member ? { ...member, id: normalizeComboModelId(member.id) } : member)
      : members
  };
}

function normalizeCapabilities(capabilities) {
  const normalized = normalizeComboCapabilities(capabilities);
  if (!normalized.ok) throw new ComboManagementError(normalized.error);
  return normalized.capabilities;
}

/**
 * Create a combo from an untrusted body.
 * @throws {ComboManagementError}
 */
export async function createComboManaged(body) {
  try {
    validateNoLog(body ?? {});
    const { name, models, members, kind, capabilities, noLog } = body ?? {};
    const allowedConnectionIds = await parseAllowedConnectionIds(body ?? {});

    if (!name) throw new ComboManagementError("Name is required");
    assertValidName(name);
    const normalizedCapabilities = normalizeCapabilities(capabilities);
    const targets = normalizeTargets(models || [], members);
    await assertNameAvailable(name);

    return await createCombo({
      name,
      models: targets.models,
      members: targets.members,
      kind: kind || null,
      capabilities: normalizedCapabilities,
      allowedConnectionIds,
      noLog
    });
  } catch (error) {
    const mapped = asManagementError(error);
    if (mapped) throw mapped;
    throw error;
  }
}

/**
 * Update a combo and invalidate its rotation/scoring state.
 * @throws {ComboManagementError}
 */
export async function updateComboManaged(id, patch) {
  try {
    // Omitted field preserves the stored policy; explicit [] clears it.
    const body = { ...(patch ?? {}) };
    validateNoLog(body);
    if (Object.prototype.hasOwnProperty.call(body, "allowedConnectionIds")) {
      body.allowedConnectionIds = await parseAllowedConnectionIds(body);
    }
    if (body.name) {
      assertValidName(body.name);
      await assertNameAvailable(body.name, id);
    }
    if (Object.hasOwn(body, "models")) {
      const targets = normalizeTargets(body.models, body.members);
      body.models = targets.models;
      if (Object.hasOwn(body, "members")) body.members = targets.members;
    }
    if (Object.hasOwn(body, "capabilities")) {
      body.capabilities = normalizeCapabilities(body.capabilities);
    }

    // Capture previous name to invalidate rotation state on rename
    const prev = await getComboById(id);
    const combo = await updateCombo(id, body);
    if (!combo) throw new ComboManagementError("Combo not found", 404);

    // Invalidate rotation + scoring state (models/strategy/name may have changed)
    if (prev?.name) { resetComboRotation(prev.name); resetComboScoring(prev.name); }
    if (combo.name && combo.name !== prev?.name) { resetComboRotation(combo.name); resetComboScoring(combo.name); }

    return combo;
  } catch (error) {
    const mapped = asManagementError(error);
    if (mapped) throw mapped;
    throw error;
  }
}

/**
 * Delete a combo and invalidate its rotation/scoring state.
 * @throws {ComboManagementError} 404 when the combo does not exist.
 */
export async function deleteComboManaged(id) {
  const prev = await getComboById(id);
  const success = await deleteCombo(id);
  if (!success) throw new ComboManagementError("Combo not found", 404);
  if (prev?.name) { resetComboRotation(prev.name); resetComboScoring(prev.name); }
  return { success: true };
}
