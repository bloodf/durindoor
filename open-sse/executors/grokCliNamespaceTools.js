/**
 * Responses `namespace` tool support for Grok Build (grok-cli).
 *
 * Codex CLI declares every MCP server (and its own multi-agent tools) as a
 * Responses `{ type: "namespace", name, tools: [...] }` group. Grok Build's
 * cli-chat-proxy accepts only flat tool types and rejects the whole request
 * with `422 tools[N].type: unknown variant "namespace"`. Responses clients
 * reach grok-cli on the same-format lane (no request translation runs), so
 * the Chat<->Responses namespace flattening in translator/request/openai-responses.js
 * never applies here.
 *
 * Flatten each child into a Responses function tool using the same dotted
 * `{namespace}.{name}` wire-name scheme the Responses translator already uses
 * (see qualifyNamespacedName in translator/request/openai-responses.js), then
 * restore the `{namespace, name}` identity on the function calls Grok returns
 * so Codex can dispatch them.
 *
 * Upstream provenance: diegosouzapw/OmniRoute#14596.
 */
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

function isRecord(value) {
  return Boolean(value) && isObject(value) && !Array.isArray(value);
}

/** `{namespace, name}` -> the flattened `{namespace}.{name}` wire name. */
function qualifyNamespacedToolName(namespace, name) {
  if (!namespace || name.startsWith(`${namespace}.`)) return name;
  return `${namespace}.${name}`;
}

/** Flatten one namespace tool group's function children into flat function tools. */
function flattenNamespaceTool(tool, identityMap) {
  const namespace = isString(tool.name) ? tool.name : "";
  const children = Array.isArray(tool.tools) ? tool.tools : [];
  return children.
  filter((child) => isRecord(child) && (child.type ?? "function") === "function" && isString(child.name) && child.name).
  map((child) => {
    const wireName = qualifyNamespacedToolName(namespace, child.name);
    if (namespace) identityMap.set(wireName, { namespace, name: child.name });
    const flat = {
      type: "function",
      name: wireName,
      parameters: isRecord(child.parameters) ? child.parameters : { type: "object", properties: {} }
    };
    if (child.description !== undefined) flat.description = child.description;
    if (child.strict !== undefined) flat.strict = child.strict;
    return flat;
  });
}

/** Rename namespaced `function_call` history items to their flattened wire names. */
function flattenNamespacedHistory(input, identityMap) {
  let changed = false;
  const next = input.map((item) => {
    if (!isRecord(item) || item.type !== "function_call") return item;
    const namespace = isString(item.namespace) ? item.namespace : "";
    const name = isString(item.name) ? item.name : "";
    if (!namespace || !name) return item;
    changed = true;
    const wireName = qualifyNamespacedToolName(namespace, name);
    identityMap.set(wireName, { namespace, name });
    const { namespace: _drop, ...rest } = item;
    return { ...rest, name: wireName };
  });
  return { input: next, changed };
}

/**
 * Flatten Responses `namespace` tool groups into function tools Grok Build
 * accepts, and rename prior namespaced `function_call` history items to the
 * matching wire names (also on follow-up turns that no longer declare the
 * namespace tools). `identityMap` is `null` when nothing needed flattening.
 */
export function flattenGrokCliNamespaceTools(body) {
  if (!isRecord(body)) return { body, identityMap: null };

  const hasNamespaceTool = Array.isArray(body.tools) && body.tools.some((t) => isRecord(t) && t.type === "namespace");
  const identityMap = new Map();
  let tools = body.tools;
  if (hasNamespaceTool) {
    tools = body.tools.flatMap((tool) => isRecord(tool) && tool.type === "namespace" ? flattenNamespaceTool(tool, identityMap) : [tool]);
  }

  const history = Array.isArray(body.input) ? flattenNamespacedHistory(body.input, identityMap) : null;
  if (!hasNamespaceTool && !history?.changed) return { body, identityMap: null };

  const next = { ...body };
  if (hasNamespaceTool) next.tools = tools;
  if (history?.changed) next.input = history.input;
  return { body: next, identityMap };
}

/** Restore `{namespace, name}` on one Responses `function_call` item, in place. */
function restoreFunctionCallIdentity(item, identityMap) {
  if (!isRecord(item) || item.type !== "function_call" || item.namespace !== undefined) return false;
  const name = isString(item.name) ? item.name : "";
  const identity = identityMap.get(name);
  if (!identity) return false;
  item.namespace = identity.namespace;
  item.name = identity.name;
  return true;
}

function restoreOutputList(output, identityMap) {
  if (!Array.isArray(output)) return false;
  let changed = false;
  for (const item of output) {
    if (restoreFunctionCallIdentity(item, identityMap)) changed = true;
  }
  return changed;
}

/** Restore identity on every function call carried by one Responses payload. */
function restorePayload(payload, identityMap) {
  if (!isRecord(payload)) return false;
  let changed = restoreFunctionCallIdentity(payload.item, identityMap);
  if (restoreOutputList(payload.output, identityMap)) changed = true;
  if (isRecord(payload.response) && restoreOutputList(payload.response.output, identityMap)) changed = true;
  return changed;
}

const SSE_BLOCK_SEPARATOR = /\r?\n\r?\n/;

function restoreSseBlock(block, identityMap) {
  return block.replace(/^data:[ \t]?(.*)$/m, (line, data) => {
    if (!data || data === "[DONE]") return line;
    try {
      const parsed = JSON.parse(data);
      return restorePayload(parsed, identityMap) ? `data: ${JSON.stringify(parsed)}` : line;
    } catch {
      return line;
    }
  });
}

/**
 * Wrap a Grok Build response so function calls on flattened namespace tools
 * come back with their original `{namespace, name}` identity. Handles SSE
 * streams and non-streaming JSON bodies; error responses pass through as-is.
 */
export async function restoreGrokCliNamespaceIdentity(response, identityMap) {
  if (!response.ok || !response.body || identityMap.size === 0) return response;
  const contentType = response.headers.get("content-type") || "";
  const init = { status: response.status, statusText: response.statusText };

  if (contentType.includes("text/event-stream")) {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    const transform = new TransformStream({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        let separator = SSE_BLOCK_SEPARATOR.exec(buffer);
        while (separator) {
          const blockEnd = separator.index + separator[0].length;
          controller.enqueue(encoder.encode(restoreSseBlock(buffer.slice(0, blockEnd), identityMap)));
          buffer = buffer.slice(blockEnd);
          separator = SSE_BLOCK_SEPARATOR.exec(buffer);
        }
      },
      flush(controller) {
        buffer += decoder.decode();
        if (buffer) controller.enqueue(encoder.encode(restoreSseBlock(buffer, identityMap)));
      }
    });
    return new Response(response.body.pipeThrough(transform), { ...init, headers: response.headers });
  }

  if (contentType.includes("application/json")) {
    const text = await response.text();
    let bodyText = text;
    try {
      const parsed = JSON.parse(text);
      if (restorePayload(parsed, identityMap)) bodyText = JSON.stringify(parsed);
    } catch {
      // Not JSON after all — forward the upstream bytes unchanged.
    }
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(bodyText, { ...init, headers });
  }

  return response;
}
