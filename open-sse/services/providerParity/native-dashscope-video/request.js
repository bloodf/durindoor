// DashScope video-synthesis bodies for the three credential variants (#2034).
//
// The body rules are the integrated Alibaba builder's,
// ../../alibabaVideo/request.js (buildAlibabaVideoRequest), reused read-only:
// its header lists the strict refusals it adds to the source builders.
//
// Source (OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad,
// open-sse/handlers/videoGeneration/dashscopeHandler.ts):
// - qwen-cloud bodies come from buildAlibabaMediaPayload, which sends
//   `wan2.7-t2v` through buildModernDashscopeTextToVideoPayload and `wan2.7-i2v`
//   through buildModernDashscopeImageToVideoPayload, the same builders as the
//   dated `wan2.7-t2v-2026-06-12` and `wan2.7-i2v-2026-04-25`;
// - qwen-cloud-token-plan and bailian-coding-plan bodies come from
//   buildHappyHorsePayload, which is what buildAlibabaMediaPayload also uses for
//   the three happyhorse-1.1 ids, the only models those two identities list.
// The integrated builder only knows the `alibaba` ids, so the two undated
// qwen-cloud ids are built with their dated sibling's rules and the body then
// carries the requested id, never the sibling's: no model is substituted on the
// wire. The models each identity accepts are its own source list only.
import { buildAlibabaVideoRequest } from "../../alibabaVideo/request.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { dashscopeVideoIdentity, dashscopeVideoModelIds } from "./config.js";

/** Undated qwen-cloud ids and the integrated builder rules they share (same source builder). */
const BUILDER_SIBLINGS = Object.freeze({
  "wan2.7-t2v": "wan2.7-t2v-2026-06-12",
  "wan2.7-i2v": "wan2.7-i2v-2026-04-25",
});

const reject = (message) => Object.assign(new Error(message), { status: 400 });

/** Whether `model` is one of `providerId`'s own source video models. */
export const isDashscopeVariantVideoModel = (providerId, model) =>
  isString(model) && dashscopeVideoModelIds(providerId).includes(model);

/**
 * The video-synthesis body for one identity's model. Throws a 400 error for a
 * model outside that identity's list or anything the integrated builder refuses.
 *
 * @returns {{ model: string, input: object, parameters: object }}
 */
export function buildDashscopeVariantVideoRequest(providerId, model, body) {
  const identity = dashscopeVideoIdentity(providerId);
  if (!identity) throw reject(`Unsupported DashScope video provider: ${providerId}`);
  if (!isDashscopeVariantVideoModel(providerId, model)) {
    throw reject(`Unsupported ${providerId} video model: ${isString(model) ? model : "(not a string)"}`);
  }
  if (!isRecord(body)) throw reject(`${identity.label} video generation needs a JSON object`);
  const sibling = BUILDER_SIBLINGS[model];
  let built;
  try {
    built = buildAlibabaVideoRequest(sibling ?? model, body);
  } catch (error) {
    // Name the requested model, not the builder sibling, and the identity, not `alibaba`.
    let message = String(error?.message ?? "Invalid video request");
    if (sibling) message = message.split(sibling).join(model);
    message = message.replace(/^Alibaba video/, `${identity.label} video`);
    throw reject(message);
  }
  return { ...built, model };
}
