import { AI_PROVIDERS } from "@/shared/constants/providers.js";
import { isString } from "@/shared/utils/typeChecks.js";

const KEYLESS_AUTH_TYPES = new Set(["optional", "none"]);

/**
 * Whether the local registry explicitly lets this provider run without a
 * pasted credential: `authType` is exactly "optional" (anonymous access works
 * and a key is still accepted) or "none" (no key exists). Anything else,
 * including missing, malformed or differently cased metadata, keeps the key
 * required. `noAuth` providers and compatible nodes have their own gates.
 */
export function registryAllowsKeylessCredential(providerId) {
  if (!isString(providerId)) return false;
  const authType = AI_PROVIDERS[providerId]?.authType;
  return isString(authType) && KEYLESS_AUTH_TYPES.has(authType);
}
