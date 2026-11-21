import { isString } from "../shared/utils/typeChecks.js";

// Labels are caller-supplied reporting metadata, never an identity or ACL.
export const MAX_ATTRIBUTION_LENGTH = 128;
export const MAX_ATTRIBUTION_VALUES = 1000;

export function validAttributionValue(value) {
  return isString(value) && value.length <= MAX_ATTRIBUTION_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value);
}

export function usageAttributionFromHeaders(headers) {
  const read = (name) => {
    const value = headers.get(name);
    return validAttributionValue(value) ? value : null;
  };
  return { sessionId: read("x-durindoor-session-id"), projectId: read("x-durindoor-project-id") };
}
