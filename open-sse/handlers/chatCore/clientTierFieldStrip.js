/**
 * Opt-in per-connection guard (`providerSpecificData.blockClientTierFields: true`, default off).
 * A client can ask for a premium service tier or send a caller identity the operator never
 * approved. With the flag on, those client fields are removed from the upstream body so they
 * reach the provider zero times. Operator-set values (an explicit `-fast`/tier model modifier,
 * connection defaults) are applied after this step and are not affected.
 * Port of OmniRoute #20891 (salvage of #20106).
 */
import { isRecord } from "../../../src/shared/utils/typeChecks.js";

export const CLIENT_TIER_FIELDS = Object.freeze([
  "service_tier",
  "safety_identifier",
  "inference_geo",
  "speed",
  "include_obfuscation"
]);

export function stripClientTierFields(body, providerSpecificData) {
  if (!isRecord(body)) return body;
  if (providerSpecificData?.blockClientTierFields !== true) return body;
  for (const field of CLIENT_TIER_FIELDS) delete body[field];
  return body;
}
