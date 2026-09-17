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
  if (existing && existing.id !== excludeId) {
    throw new ComboManagementError("Combo name already exists");
  }
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
    const { name, models, members, kind, capabilities } = body ?? {};
    const allowedConnectionIds = await parseAllowedConnectionIds(body ?? {});

    if (!name) throw new ComboManagementError("Name is required");
    assertValidName(name);
    const normalizedCapabilities = normalizeCapabilities(capabilities);
    await assertNameAvailable(name);

    return await createCombo({
      name,
      models: models || [],
      members,
      kind: kind || null,
      capabilities: normalizedCapabilities,
      allowedConnectionIds
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
    if (Object.prototype.hasOwnProperty.call(body, "allowedConnectionIds")) {
      body.allowedConnectionIds = await parseAllowedConnectionIds(body);
    }
    if (body.name) {
      assertValidName(body.name);
      await assertNameAvailable(body.name, id);
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
