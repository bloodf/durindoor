// Direct claude↔gemini view of the store in thoughtSignatureStore.js (key
// scheme, TTLs, prune cap and legacy rows are documented there), plus the
// signature-mode helpers.
import { clearThoughtSignatures, getKeyedThoughtSignature } from "./thoughtSignatureStore.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

export {
  scopedSignatureKey as buildGeminiThoughtSignatureKey,
  storeKeyedThoughtSignature as storeGeminiThoughtSignature,
  getKeyedThoughtSignature as getGeminiThoughtSignature,
  prunePersistedNow,
  prunePersisted,
  pruneForTests as _pruneForTests,
  clearThoughtSignatureMemory as clearGeminiThoughtSignatureMemoryForTests,
  getThoughtSignatureMemorySize as getGeminiThoughtSignatureMemorySizeForTests,
} from "./thoughtSignatureStore.js";

let signatureCacheMode = "enabled";

export function resolveGeminiThoughtSignature(key, clientSignature) {
  return isString(clientSignature) && clientSignature ? clientSignature : getKeyedThoughtSignature(key);
}

export function normalizeSignatureCacheMode(value) {
  return value === "bypass" || value === "bypass-strict" ? value : "enabled";
}
export function setGeminiThoughtSignatureMode(mode) {signatureCacheMode = normalizeSignatureCacheMode(mode);}
export function getGeminiThoughtSignatureMode() {return signatureCacheMode;}
export function isValidBasicGeminiThoughtSignature(signature) {return isString(signature) && /^[RE][A-Za-z0-9+/]+={0,2}$/.test(signature);}
export function isValidFullGeminiThoughtSignature(signature) {return isValidBasicGeminiThoughtSignature(signature);}

export async function clearGeminiThoughtSignatures() {
  signatureCacheMode = "enabled";
  await clearThoughtSignatures();
}
