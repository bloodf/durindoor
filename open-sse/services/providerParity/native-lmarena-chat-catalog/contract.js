// Arena (lmarena) chat wire reference. Dormant: nothing calls it at runtime.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/executors/lmarena.ts (LMArenaExecutor.transformRequest). The local
// executor (open-sse/executors/lmarena.js upstreamBody) already sends this
// envelope. Only `modelAId` changes when the resolver is wired in, so this
// shape lets tests pin the model mapping without a second wire builder.
// Differences kept on purpose: the source always sends `recaptchaV3Token`
// (null when absent) and an optional operator `cx`; the local executor sends
// the token only when the operator supplied one and never synthesises `cx`.
// No reCAPTCHA token is ever generated or solved here.
import { LMARENA_CHAT_WIRE_MODALITY, LMARENA_CHAT_WIRE_MODE } from "./config.js";

/** Fields of the source create-evaluation body, in source order. */
export const LMARENA_SOURCE_CHAT_WIRE_KEYS = Object.freeze([
  "id", "mode", "modelAId", "userMessageId", "modelAMessageId", "userMessage", "modality", "recaptchaV3Token",
]);

/**
 * The source transformRequest body for a resolved Arena id.
 * @param {object} input
 * @param {string} input.arenaModelId - resolver output, sent as `modelAId`
 * @param {string} input.content - the formatted prompt
 * @param {{id: string, userMessageId: string, modelAMessageId: string}} input.ids - caller-supplied ids
 * @param {string|null} [input.recaptchaV3Token] - operator-supplied only
 */
export function buildLmarenaSourceChatWire({ arenaModelId, content, ids, recaptchaV3Token = null }) {
  return {
    id: ids.id,
    mode: LMARENA_CHAT_WIRE_MODE,
    modelAId: arenaModelId,
    userMessageId: ids.userMessageId,
    modelAMessageId: ids.modelAMessageId,
    userMessage: { content, experimental_attachments: [], metadata: {} },
    modality: LMARENA_CHAT_WIRE_MODALITY,
    recaptchaV3Token,
  };
}
