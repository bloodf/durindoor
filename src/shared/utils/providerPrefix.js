import { isString } from "./typeChecks.js";
import {
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
  isCustomEmbeddingProvider,
  isSystemoneCompatibleProvider
} from "@/shared/constants/providers.js";

/**
 * True when a provider id belongs to a custom provider node.
 *
 * Custom providers (OpenAI-/Anthropic-compatible, custom embedding, System One)
 * are created as provider nodes whose id is a UUID-bearing string such as
 * `openai-compatible-chat-330c58ab-a28a-46ed-9baa-0e1c8510562c`. They are not
 * registry entries, so a registry alias lookup can never name them. A node
 * installed before the prefix scheme carries a bare UUID as its id; no
 * registry provider id looks like one.
 *
 * @param {unknown} providerId
 * @returns {boolean}
 */
export function isCustomProviderId(providerId) {
  if (!isString(providerId) || !providerId) return false;
  return isOpenAICompatibleProvider(providerId) ||
    isAnthropicCompatibleProvider(providerId) ||
    isCustomEmbeddingProvider(providerId) ||
    isSystemoneCompatibleProvider(providerId) ||
    /^[0-9a-f-]{16,}$/i.test(providerId);
}

/**
 * Resolve the prefix a provider is labelled with in a published model id.
 *
 * A custom provider node is labelled with the short prefix the operator
 * configured on it ("mirai"), not by its internal node id. The dashboard
 * advertises the prefix and `/v1/models` publishes it.
 *
 * A prefix is a label, not a stable request id: an operator can edit it, and
 * two nodes can carry the same one. Where a caller must keep a request bound
 * to one selected node (the Playground), it sends the node id and uses this
 * prefix only for display. The server accepts both forms and resolves each to
 * the node.
 *
 * Precedence:
 *   1. `providerSpecificData.prefix` — written onto the connection when it is
 *      created (POST /api/providers) and kept in sync when the node is edited
 *      (PUT /api/provider-nodes/[id]).
 *   2. `node.prefix` — the provider-node row itself, for callers that already
 *      hold the node but not the connection.
 *   3. the provider id — a built-in provider keeps its own id, and a custom
 *      node without a configured prefix keeps its node id as the stable
 *      legacy label.
 *
 * A built-in provider is never remapped: a stray `prefix` field on a built-in
 * connection must not rename its models.
 *
 * The prefix never selects an upstream credential and never builds an
 * upstream URL — routing still resolves a prefix back to the node id through
 * the provider-nodes lookup.
 *
 * @param {object} input
 * @param {string} [input.providerId] Provider id or node id.
 * @param {object} [input.providerSpecificData] Connection's providerSpecificData.
 * @param {object} [input.node] Provider node row (optional).
 * @returns {string} The prefix to publish (falls back to the provider id).
 */
export function resolveProviderPrefix({ providerId, providerSpecificData, node } = {}) {
  if (!isString(providerId) || !providerId) return "";

  // Only provider nodes are remapped. A built-in provider keeps its own id
  // even when its connection happens to carry a `prefix` field.
  if (!node && !isCustomProviderId(providerId)) return providerId;

  const connectionPrefix = providerSpecificData?.prefix;
  if (isString(connectionPrefix) && connectionPrefix.trim()) return connectionPrefix.trim();

  const nodePrefix = node?.prefix;
  if (isString(nodePrefix) && nodePrefix.trim()) return nodePrefix.trim();

  // A custom node without a configured prefix keeps its node id as the legacy
  // label, which still routes to the same node.
  return providerId;
}
