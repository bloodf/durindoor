import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

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
    typeof m.id === "string" && m.id.includes("/")
      ? m.id.split("/")[0] ?? ""
      : (m.owned_by ?? "");
  const caps = getCapabilitiesForModel(provider, m.id);
  return {
    slug: m.id,
    display_name: m.id,
    supported_in_api: true,
    supports_search_tool: !!caps?.search,
    tool_mode: "auto",
    multi_agent_version: null,
  };
}

function toAnthropicModel(m) {
  const id = typeof m.id === "string" ? m.id : "";
  const displayName =
    (typeof m.display_name === "string" && m.display_name) ||
    (typeof m.name === "string" && m.name) ||
    id;
  return {
    type: "model",
    id,
    display_name: displayName,
    // Anthropic ModelInfo.created_at is a required ISO string; epoch when unknown.
    created_at:
      typeof m.created_at === "string" && m.created_at ? m.created_at : "1970-01-01T00:00:00Z",
  };
}

function buildAnthropicModelsResponse(data, headers) {
  const ids = data
    .map((m) => (typeof m.id === "string" ? m.id : null))
    .filter((id) => id !== null);
  return Response.json(
    {
      data: data.map(toAnthropicModel),
      has_more: false,
      first_id: ids.length > 0 ? ids[0] : null,
      last_id: ids.length > 0 ? ids[ids.length - 1] : null,
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
