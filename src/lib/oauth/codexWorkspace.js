import { resolveCodexAccountId } from "open-sse/shared/codexAccountId.js";
import { isString } from "../../shared/utils/typeChecks.js";

/** Bind an optional workspace to the server-owned OAuth flow. */
export function codexWorkspaceFromMeta(meta = {}) {
  const values = [meta.allowed_workspace_id, meta.workspace_id, meta.expectedWorkspaceId]
    .filter((value) => value !== undefined && value !== null && value !== "");
  if (values.some((value) => !isString(value) || !value.trim() || value.trim().length > 256 || /[\x00-\x1f\x7f]/.test(value))) {
    const error = new Error("Invalid Codex workspace ID");
    error.code = "OAUTH_VALIDATION_FAILED";
    throw error;
  }
  const ids = [...new Set(values.map((value) => value.trim()))];
  if (ids.length > 1) {
    const error = new Error("Conflicting Codex workspace IDs");
    error.code = "OAUTH_VALIDATION_FAILED";
    throw error;
  }
  return ids[0] || "";
}

/** A selected workspace must be present in the token received from OpenAI. */
export function requireCodexWorkspace(idToken, expected) {
  if (expected && resolveCodexAccountId({}, idToken) !== expected) {
    const error = new Error("Codex token did not match the selected workspace");
    error.code = "OAUTH_VALIDATION_FAILED";
    throw error;
  }
}
