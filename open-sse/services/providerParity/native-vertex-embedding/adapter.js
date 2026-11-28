import { isString } from "../../../../src/shared/utils/typeChecks.js";
import { createErrorResult, readBoundedResponseText, parseRateLimitEvidence } from "../../../utils/error.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { VERTEX_EMBEDDING_MODELS, VERTEX_EMBEDDING_TIMEOUT_MS, VERTEX_EMBEDDING_MAX_RESPONSE_BYTES } from "./config.js";
import { buildVertexEmbeddingPlan, mapVertexEmbeddingResponse } from "./request.js";
import { vertexEmbeddingScope, vertexEmbeddingUrl, mintVertexEmbeddingToken } from "./auth.js";
const fail = (status, message) => createErrorResult(status, `Vertex embeddings: ${message}`);
const unsent = (error) => error?.notSent === true || error?.name === "OutboundUrlGuardError" || ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"].includes(error?.cause?.code ?? error?.code);
/** Unknown acceptance is a no-replay ledger marker, not a zero-cost receipt. */
export function vertexEmbeddingAcceptedJob(result, jobState = "submit-unknown") {
  return { ...result, acceptedJob: { ...mediaAccounting(null, "vertex", "embedding"), costSource: "accepted-job", meta: { jobState, usageMissing: true } } };
}
/**
 * Private embedding core adapter. One total deadline covers signing, minting,
 * sequential prediction sends and all reads. No retry or account reselection.
 * `fetch` substitutes only the network boundary in tests; auth remains real.
 */
export function createVertexEmbeddingAdapter({ timeoutMs = VERTEX_EMBEDDING_TIMEOUT_MS, fetch: fetchOverride } = {}) {
  return {
    provider: "vertex", models: VERTEX_EMBEDDING_MODELS,
    buildUrl: (model, credentials) => vertexEmbeddingUrl(vertexEmbeddingScope(credentials), model),
    buildBody: (model, body) => buildVertexEmbeddingPlan(model, body).body,
    async embed({ model, body, credentials, signal }) {
      let plan, scope, proxy;
      try {
        plan = buildVertexEmbeddingPlan(model, body);
        scope = vertexEmbeddingScope(credentials);
        proxy = structuredClone(resolveCredentialProxyOptions(credentials));
      } catch (error) { return fail(error.status ?? 400, error.message); }
      if (signal?.aborted) return fail(499, "request aborted before send");
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal?.addEventListener("abort", abort, { once: true });
      const deadline = Date.now() + timeoutMs;
      const remaining = () => Math.max(1, deadline - Date.now());
      const timer = setTimeout(() => controller.abort(Object.assign(new Error("deadline"), { name: "TimeoutError" })), Math.max(1, timeoutMs));
      let stage = "auth", pendingSubmit = false, completed = 0;
      // Signals actually reach both Google endpoints; racing additionally bounds
      // a broken transport which ignores abort. Late responses are cancelled.
      const network = fetchOverride ?? ((url, init) => proxyAwareFetch(url, init, proxy));
      const send = async (url, init) => {
        controller.signal.throwIfAborted();
        const response = await network(url, { ...init, signal: controller.signal });
        if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); controller.signal.throwIfAborted(); }
        return response;
      };
      let stop;
      const bound = new Promise((_, reject) => {
        stop = () => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", stop, { once: true });
      });
      const work = async () => {
        const token = await mintVertexEmbeddingToken(scope.sa, { signal: controller.signal, send, remaining });
        const url = vertexEmbeddingUrl(scope, model);
        const predictions = [];
        for (const request of plan.bodies) {
          controller.signal.throwIfAborted();
          stage = "submit";
          pendingSubmit = true;
          let response;
          try {
            response = await send(url, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(request) });
          } catch (error) { if (unsent(error)) pendingSubmit = false; throw error; }
          const uncertain = (result) => vertexEmbeddingAcceptedJob(result);
          if (response.redirected || (response.url && response.url !== url)) {
            void response.body?.cancel().catch(() => {});
            return uncertain(fail(502, "unexpected response URL"));
          }
          if (!response.ok) {
            const status = response.status;
            const retry = response.headers.get("retry-after");
            void response.body?.cancel().catch(() => {});
            pendingSubmit = status >= 500;
            let result = fail(status >= 400 && status < 500 ? status : 502, status >= 300 && status < 400 ? "redirect refused" : `provider refused request (${status})`);
            if (status === 429) {
              const evidence = parseRateLimitEvidence({ status, headers: new Headers(retry ? { "retry-after": retry } : {}), now: Date.now() });
              if (evidence?.source === "retry_after") result = createErrorResult(429, "Vertex embeddings rate limited", evidence.resetAtMs, undefined, evidence);
            }
            if (status === 402) result.quotaExhausted = true;
            return pendingSubmit || completed ? uncertain(result) : result;
          }
          stage = "body";
          const text = await readBoundedResponseText(response, { signal: controller.signal, maxBytes: VERTEX_EMBEDDING_MAX_RESPONSE_BYTES, timeoutMs: remaining(), throwOnTimeout: true });
          const raw = JSON.parse(text);
          // Validate each receipt before continuing a single-instance batch.
          mapVertexEmbeddingResponse(raw, { ...plan, itemCount: request.instances.length });
          predictions.push(...raw.predictions);
          completed++;
          pendingSubmit = false;
        }
        const payload = mapVertexEmbeddingResponse({ predictions }, plan);
        payload.model = isString(body.model) && !body.model.includes("/") ? body.model : `vertex/${model}`;
        const accounting = mediaAccounting(null, "vertex", "embedding");
        accounting.nativeUnits = { inputs: plan.itemCount };
        accounting.meta.usageMissing = true;
        accounting.meta.publicUsageFallback = "zero-placeholder-not-receipt";
        return { success: true, accounting, response: new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
      };
      const pending = work();
      try { return await Promise.race([pending, bound]); }
      catch (error) {
        const status = signal?.aborted ? 499 : controller.signal.reason?.name === "TimeoutError" || error?.name === "TimeoutError" ? 504 : 502;
        const result = fail(status, stage === "auth" ? "token exchange failed or aborted" : "request failed or answer unusable; outcome may be unknown");
        return pendingSubmit || completed ? vertexEmbeddingAcceptedJob(result, stage === "body" ? "completed-unusable" : "submit-unknown") : result;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        controller.signal.removeEventListener("abort", stop);
        pending.catch(() => {});
        bound.catch(() => {});
      }
    },
  };
}
