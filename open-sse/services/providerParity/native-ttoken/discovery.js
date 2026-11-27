// Staged only. Key-scoped model list for the OpenAI-style TTOken catalogue named in
// MIT-licensed OmniRoute PR #21441, src/app/api/providers/[id]/models/discovery/providerSets.ts
// at 7ec5270551bdda0c0a692c7aea9b9ee0fd0ccc77.
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { isString } from "../../../../src/shared/utils/typeChecks.js";
import provider from "./config.js";

const DEADLINE_MS = 8000;

const failure = (error, status) => ({ error, status });
const cancelled = () => failure("TTOken model discovery was cancelled", 499);
const malformed = () => failure("TTOken returned an invalid model list", 502);

// Upstream bodies are never relayed. A 403 says nothing about quota.
function refused(status) {
  if (status === 401) return failure("TTOken rejected the API key", status);
  if (status === 403) return failure("TTOken refused this key; check that it is a Gateway product API key", status);
  if (status === 429) return failure("TTOken rate limited model discovery", status);
  if (status >= 300 && status < 400) return failure("TTOken model discovery refused a redirect", 502);
  return failure(`TTOken model discovery failed (${status})`, status);
}

/**
 * List the models one connection's key may run. Every call asks upstream: nothing is
 * cached, redirects are not followed, and the registry seed never stands in for a
 * failed read, so a list cannot cross keys or pass for key verification.
 *
 * @param {{ id?: string, apiKey?: string }} connection
 * @param {{ signal?: AbortSignal|null, proxyOptions?: object|null, fetchImpl?: Function }} [options]
 */
export async function discoverTtokenModels(connection, { signal = null, proxyOptions = null, fetchImpl = proxyAwareFetch } = {}) {
  const apiKey = connection?.apiKey;
  if (!apiKey) return failure("TTOken model discovery requires a Gateway API key", 401);
  if (signal?.aborted) return cancelled();
  const deadline = AbortSignal.timeout(DEADLINE_MS);
  try {
    const response = await fetchImpl(provider.modelsFetcher.url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      redirect: "manual",
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    }, proxyOptions);
    if (!response.ok) {
      response.body?.cancel().catch(() => {});
      return refused(response.status);
    }
    const body = await response.json();
    if (!Array.isArray(body?.data)) return malformed();
    const models = body.data.filter((model) => isString(model?.id) && model.id.trim());
    return { provider: provider.id, connectionId: connection.id, models, source: "provider_api" };
  } catch (error) {
    if (signal?.aborted) return cancelled();
    if (deadline.aborted) return failure("TTOken model discovery timed out", 504);
    if (error instanceof SyntaxError) return malformed();
    return failure("TTOken model discovery is unreachable", 502);
  }
}
