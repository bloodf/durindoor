import { guardedProbeFetch } from "../utils/outboundUrlGuard.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

export const OPENCODE_SERVER_ID = "opencode-server";
export const OPENCODE_GENERATE_PATH = "/api/experimental/generate/text";

/** Only saved connection fields select the server and its Basic credential. */
export function resolveOpenCodeServer({ providerSpecificData, apiKey } = {}) {
  const raw = providerSpecificData?.baseUrl;
  let url;
  try {
    if (isString(raw)) url = new URL(raw.trim());
  } catch {
    // Report configuration errors without echoing credential-bearing URLs.
  }
  if (!url || !["http:", "https:"].includes(url.protocol) ||
      url.username || url.password || url.search || url.hash) {
    return { error: "OpenCode Server requires an explicit HTTP(S) base URL", status: 400 };
  }
  const separator = isString(apiKey) ? apiKey.indexOf(":") : -1;
  if (separator < 1 || separator === apiKey.length - 1) {
    return { error: "OpenCode Server requires a username:password credential", status: 400 };
  }
  return {
    baseUrl: url.href.replace(/\/+$/, ""),
    headers: {
      Authorization: `Basic ${Buffer.from(apiKey, "utf8").toString("base64")}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  };
}

export async function fetchOpenCodeServerModels(connection, guard, fetcher) {
  const endpoint = resolveOpenCodeServer(connection);
  if (endpoint.error) return endpoint;
  try {
    const response = await guardedProbeFetch(`${endpoint.baseUrl}/api/model`, {
      headers: endpoint.headers,
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    }, guard, fetcher);
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return { error: `OpenCode Server catalog returned HTTP ${response.status}`, status: response.status >= 400 ? response.status : 502 };
    }
    const payload = await response.json();
    if (!Array.isArray(payload?.data)) return { error: "Invalid OpenCode Server model catalog", status: 502 };
    const models = payload.data.flatMap((model) => {
      if (model?.enabled !== true || (model.type && model.type !== "chat") ||
          !isString(model.providerID) || !model.providerID || model.providerID.includes("/") ||
          !isString(model.id) || !model.id) return [];
      const id = `${model.providerID}/${model.id}`;
      return [{ id, name: isString(model.name) && model.name ? model.name : id }];
    });
    return { models };
  } catch {
    return { error: "OpenCode Server catalog unavailable", status: 502 };
  }
}
