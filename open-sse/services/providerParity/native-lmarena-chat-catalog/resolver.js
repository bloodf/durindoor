// Arena (lmarena) chat model resolver: requested model -> Arena `modelAId`.
// Staged; not imported by production code.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/providers/registry/lmarena/directModels.ts
// (resolveLmarenaArenaId) and open-sse/executors/lmarena/models.ts
// (stripLMArenaModelPrefix, LMARENA_MODEL_ID_RE, resolveLMArenaModelId).
// Source rules kept verbatim:
//   - strip one leading `lmarena/`, `lma/` or `arena/` (any case), then trim;
//   - a UUID-shaped id is an explicit Arena id;
//   - otherwise the FIRST row (source order) whose catalog id, public name or
//     display name equals the request, exactly or case-insensitively, wins.
//     So `grok-4.3` (public name of both `grok-4.3/text` and `grok-4.3/search`)
//     resolves to the Text row, exactly as in the source.
// Intentional, source-backed deltas (see the port report):
//   - only the 48 chat rows are searched. The source searches all 75 rows, so it
//     would send an Image row's UUID with `modality: "chat"`; the image flow is
//     unsupported (native-lmarena-image), so Image names and UUIDs are refused.
//   - an unknown non-UUID name is refused. The source falls back to sending the
//     raw name as `modelAId`, which create-evaluation cannot accept (it needs an
//     Arena UUID). Nothing is guessed.
//   - a UUID that matches a chat row maps to that row's canonical lowercase id.
// Refusals never echo the requested value and never read credentials.
import { isString } from "../../../../src/shared/utils/typeChecks.js";
import { resolveLmarenaImageModel } from "../native-lmarena-image/config.js";
import { LMARENA_CHAT_MODELS } from "./config.js";

export const LMARENA_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIX_RE = /^(?:lmarena|lma|arena)\//i;

export const LMARENA_CHAT_REFUSAL_STATUS = 400;
export const LMARENA_CHAT_REFUSALS = Object.freeze({
  invalid: Object.freeze({ code: "lmarena_invalid_model", message: "Arena (lmarena) chat needs a model id" }),
  image: Object.freeze({
    code: "lmarena_image_model_not_chat",
    message: "Arena (lmarena) image models are not chat models, and Arena image generation is not supported",
  }),
  unknown: Object.freeze({ code: "lmarena_unknown_model", message: "Unknown Arena (lmarena) chat model" }),
});

/** Source stripLMArenaModelPrefix. Non-strings become "". */
export function stripLmarenaModelPrefix(model) {
  return isString(model) ? model.replace(PREFIX_RE, "").trim() : "";
}

function refuse(kind) {
  return Object.freeze({ ok: false, status: LMARENA_CHAT_REFUSAL_STATUS, reason: kind, ...LMARENA_CHAT_REFUSALS[kind] });
}

function accept(arenaModelId, model, via) {
  return Object.freeze({ ok: true, arenaModelId, model, via });
}

function matchVia(model, raw) {
  if (model.id === raw || model.id.toLowerCase() === raw.toLowerCase()) return "catalog-id";
  if (model.publicName === raw || model.publicName.toLowerCase() === raw.toLowerCase()) return "public-name";
  return "display-name";
}

/**
 * @param {unknown} requested - the routed model, with or without a provider prefix
 * @param {object} [options]
 * @param {boolean} [options.allowUnknownUuid=true] - source behavior: an explicit
 *   UUID outside the catalog is sent as-is. false refuses it as unknown.
 * @returns {{ok: true, arenaModelId: string, model: object|null, via: string}
 *   | {ok: false, status: 400, reason: string, code: string, message: string}}
 */
export function resolveLmarenaChatModel(requested, { allowUnknownUuid = true } = {}) {
  const raw = stripLmarenaModelPrefix(requested);
  if (!raw) return refuse("invalid");

  if (LMARENA_UUID_RE.test(raw)) {
    const lower = raw.toLowerCase();
    const chat = LMARENA_CHAT_MODELS.find((model) => model.arenaId === lower);
    if (chat) return accept(chat.arenaId, chat, "uuid-catalog");
    if (resolveLmarenaImageModel(raw)) return refuse("image");
    return allowUnknownUuid ? accept(raw, null, "uuid-passthrough") : refuse("unknown");
  }

  const lower = raw.toLowerCase();
  const hit = LMARENA_CHAT_MODELS.find((model) =>
    model.id === raw || model.publicName === raw || model.name === raw ||
    model.id.toLowerCase() === lower || model.publicName.toLowerCase() === lower || model.name.toLowerCase() === lower);
  if (hit) return accept(hit.arenaId, hit, matchVia(hit, raw));
  if (resolveLmarenaImageModel(raw)) return refuse("image");
  return refuse("unknown");
}

/** The Arena `modelAId` for a request, or null when it is refused. */
export function resolveLmarenaChatArenaId(requested, options) {
  const result = resolveLmarenaChatModel(requested, options);
  return result.ok ? result.arenaModelId : null;
}

/**
 * The 400 an integrated executor returns for a refused model, before it reads
 * the cookie or calls the TLS client. Carries no request data.
 */
export function lmarenaChatRefusalResponse(result) {
  const refusal = result && result.ok === false ? result : refuse("invalid");
  return Response.json(
    { error: { message: refusal.message, type: "invalid_request_error", code: refusal.code } },
    { status: LMARENA_CHAT_REFUSAL_STATUS },
  );
}
