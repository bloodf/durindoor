import { getCapabilitiesForModel, resolveModelLimits } from "open-sse/providers/capabilities.js";
import { isString } from "../../../../shared/utils/typeChecks.js";

function isCodexUserAgent(request) {
  const originator = request.headers.get("originator") ?? "";
  const userAgent = request.headers.get("user-agent") ?? "";
  return originator === "codex_cli_rs" || /codex/i.test(userAgent);
}

function isAnthropicRequest(request) {
  // Header PRESENCE selects the Anthropic envelope, even when the value is empty.
  return request.headers.has("anthropic-version");
}

function toCodexModel(m) {
  const provider =
  isString(m.id) && m.id.includes("/") ?
  m.id.split("/")[0] ?? "" :
  m.owned_by ?? "";
  const caps = getCapabilitiesForModel(provider, m.id);
  // Advertise the window only when it is a real catalog value. resolveModelLimits
  // reports `known: false` for the generic floor, and publishing that as fact is
  // how clients end up truncating against a limit the model does not have.
  const limits = resolveModelLimits(provider, m.id);
  return {
    slug: m.id,
    display_name: m.id,
    supported_in_api: true,
    supports_search_tool: !!caps?.search,
    tool_mode: "auto",
    multi_agent_version: null,
    ...(limits.known ?
    { context_window: limits.contextWindow, max_output_tokens: limits.maxOutput } : null)

  };
}

function toAnthropicModel(m) {
  const id = isString(m.id) ? m.id : "";
  const displayName =
  isString(m.display_name) && m.display_name ||
  isString(m.name) && m.name ||
  id;
  return {
    type: "model",
    id,
    display_name: displayName,
    // Anthropic ModelInfo.created_at is a required ISO string; epoch when unknown.
    created_at:
    isString(m.created_at) && m.created_at ? m.created_at : "1970-01-01T00:00:00Z"
  };
}

/**
 * Serialize the Anthropic `/v1/models` paginated envelope. The catalog is small
 * and returned in full, so `has_more` is always `false`; `first_id`/`last_id`
 * bound the page (both `null` on an empty catalog) per the List shape contract.
 *
 * @param {object[]} data Internal model records to project via {@link toAnthropicModel}.
 * @param {Record<string, string>} headers Response headers to forward (CORS).
 * @returns {Response} JSON `200` envelope.
 */
function buildAnthropicModelsResponse(data, headers) {
  const ids = data.
  map((m) => isString(m.id) ? m.id : null).
  filter((id) => id !== null);
  return Response.json(
    {
      data: data.map(toAnthropicModel),
      has_more: false,
      first_id: ids.length > 0 ? ids[0] : null,
      last_id: ids.length > 0 ? ids[ids.length - 1] : null
    },
    { headers }
  );
}

/**
 * Build the /v1/models response, shaping it for Anthropic (when the
 * `anthropic-version` header is present) or Codex CLI when detected.
 * Anthropic takes precedence: the header is an explicit envelope request.
 *
 * @param {Request} request
 * @param {object[]} data
 * @returns {Response}
 */
export function buildModelsResponse(request, data) {
  const headers = { "Access-Control-Allow-Origin": "*" };
  if (isAnthropicRequest(request)) {
    return buildAnthropicModelsResponse(data, headers);
  }
  if (isCodexUserAgent(request)) {
    return Response.json({ models: data.map(toCodexModel) }, { headers });
  }
  return Response.json({ object: "list", data }, { headers });
}