import { NextResponse } from "next/server";
import { normalizeSystemoneBaseUrl } from "open-sse/config/systemone.js";
import { guardedProbeFetch, OutboundUrlGuardError } from "open-sse/utils/outboundUrlGuard.js";
import { readBoundedResponseText } from "open-sse/utils/error.js";
import { isString, isObject } from "../../../../shared/utils/typeChecks.js";

/**
 * Guard every provider-node probe against SSRF and bound it to ten seconds,
 * while retaining cancellation supplied by a caller.
 */
const guardedFetch = (url, options = {}, timeout = 10000) => {
  const timeoutSignal = AbortSignal.timeout(timeout);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
  return guardedProbeFetch(url, { ...options, signal });
};

const MAX_DISCOVERY_BYTES = 1024 * 1024;
const MAX_DISCOVERED_MODELS = 1000;

async function readDiscoveryJson(response, signal) {
  const text = await readBoundedResponseText(response, {
    signal,
    maxBytes: MAX_DISCOVERY_BYTES,
    timeoutMs: 10000,
    throwOnTimeout: true,
  });
  try { return JSON.parse(text); } catch { throw new Error("Invalid model discovery response"); }
}

// Validate URL format. Only http(s) is allowed; the SSRF guard below adds
// the hostname policy. Reject here so we can return a friendly 400 instead
// of falling through to the guard's 403.
const isValidUrl = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

// Parse error details for user-friendly messages
const getErrorMessage = (error) => {
  if (error.cause?.code === "ECONNREFUSED") return "Connection refused - provider node offline or unreachable";
  if (error.cause?.code === "ENOTFOUND") return "DNS lookup failed - invalid domain or network issue";
  if (error.cause?.code === "ETIMEDOUT") return "Connection timeout - provider node too slow";
  if (error.message.includes("timeout")) return "Request timeout (>10s) - provider node not responding";
  if (error.cause?.code === "CERT_HAS_EXPIRED") return "SSL certificate expired";
  if (error.cause?.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") return "SSL certificate verification failed";
  if (error.cause?.code) return `Network error: ${error.cause.code}`;
  return "Network connection failed - check URL and network connectivity";
};

// Get status-specific error message for /models endpoint
const getModelsErrorMessage = (status) => {
  if (status === 401 || status === 403) return "API key unauthorized";
  if (status === 404) return "/models endpoint not found - try chat validation with model ID";
  if (status >= 500) return "Server error - try again later";
  return `Unexpected response (${status})`;
};

// Get status-specific error message for /chat/completions endpoint
const getChatErrorMessage = (status) => {
  if (status === 401 || status === 403) return "API key unauthorized";
  if (status === 400) return "Invalid model or bad request";
  if (status === 404) return "Chat endpoint not found";
  if (status >= 500) return "Server error - try again later";
  return `Chat request failed (${status})`;
};

// Allowed `type` values posted by the dashboard modals. Anything else is
// rejected before we ever touch the network.
const ALLOWED_TYPES = new Set([
  "openai-compatible",
  "anthropic-compatible",
  "custom-embedding",
  "systemone-compatible",
]);

// Uniform SSRF-guard rejection. Never echo the parsed hostname back — the
// guard logs the rejection server-side.
const blockedResponse = (err) => {
  if (err) console.log("Provider node URL blocked by SSRF guard:", err?.message, "url=", err?.url);
  return NextResponse.json({ valid: false, error: "URL not allowed", blocked: true }, { status: 403 });
};

// POST /api/provider-nodes/validate - Validate API key against base URL
export async function POST(request) {
  try {
    const body = await request.json();
    const { baseUrl, apiKey, type, modelId } = body;

    if (!baseUrl) {
      return NextResponse.json({ error: "Base URL required" }, { status: 400 });
    }
    if (type !== "systemone-compatible" && !apiKey) {
      return NextResponse.json({ error: "Base URL and API key required" }, { status: 400 });
    }

    // Validate URL format (http(s) only)
    if (!isValidUrl(baseUrl)) {
      return NextResponse.json({ error: "Invalid URL format" }, { status: 400 });
    }

    // `type` allowlist — reject unknown kinds before any outbound traffic.
    if (!type || !ALLOWED_TYPES.has(type)) {
      return NextResponse.json({ error: "Invalid provider type" }, { status: 400 });
    }

    // SSRF guard applies to EVERY probe in this route (local + remote
    // callers, embeddings/models/chat). Loopback/LAN provider nodes still
    // work in the default "block-metadata" mode; set
    // OMNIROUTE_ALLOW_LOCAL_PROVIDER_URLS=false (→ "public-only") to also
    // reject LAN/loopback for remote callers.
    // The fetch helper itself (guardedProbeFetch) re-runs
    // `assertOutboundUrlAllowed` on every URL it opens.

    if (type === "systemone-compatible") {
      let modelsUrl;
      try { modelsUrl = `${normalizeSystemoneBaseUrl(baseUrl)}/models`; } catch (error) {
        return NextResponse.json({ valid: false, error: error.message }, { status: 400 });
      }
      const probeSignal = AbortSignal.any([request.signal, AbortSignal.timeout(10000)]);
      let res;
      try {
        res = await guardedFetch(modelsUrl, { method: "GET", headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, redirect: "manual", signal: probeSignal });
      } catch (err) {
        if (err instanceof OutboundUrlGuardError) return blockedResponse(err);
        throw err;
      }
      if (res.ok) {
        let payload;
        try { payload = await readDiscoveryJson(res, probeSignal); } catch (error) {
          return NextResponse.json({ valid: false, error: error.message }, { status: 400 });
        }
        const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : null;
        if (!rows || rows.length > MAX_DISCOVERED_MODELS) {
          return NextResponse.json({ valid: false, error: "Invalid or oversized model catalog" }, { status: 400 });
        }
        const models = [];
        const ids = new Set();
        for (const row of rows) {
          const id = isString(row) ? row : row && isObject(row) ? row.id ?? row.name : null;
          const cleanId = isString(id) ? id.trim() : "";
          if (!cleanId || cleanId.length > 256 || ids.has(cleanId)) continue;
          ids.add(cleanId);
          if (isString(row?.name) && row.name.trim()) {
            models.push({ id: cleanId, name: row.name.trim().slice(0, 256) });
          } else {
            models.push({ id: cleanId });
          }
        }
        return NextResponse.json({ valid: true, discovery: "models", models });
      }
      if (res.status === 401 || res.status === 403) return NextResponse.json({ valid: false, error: apiKey ? "API key unauthorized" : "API key required" });
      if ([404, 405, 501].includes(res.status)) return NextResponse.json({ valid: false, skipped: true, unsupported: true, discoverySupported: false, error: "Model discovery unavailable. Register native model ID manually." });
      return NextResponse.json({ valid: false, error: `Model discovery failed (${res.status})` });
    }

    // Custom Embedding Validation - test POST /embeddings directly
    if (type === "custom-embedding") {
      const normalizedBase = baseUrl.trim().replace(/\/$/, "");
      if (!modelId?.trim()) {
        return NextResponse.json({ valid: false, error: "Model ID required for embedding validation" });
      }
      let embedRes;
      try {
        embedRes = await guardedFetch(`${normalizedBase}/embeddings`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ model: modelId.trim(), input: "ping" })
        });
      } catch (err) {
        if (err instanceof OutboundUrlGuardError) return blockedResponse(err);
        throw err;
      }
      if (embedRes.ok) {
        const data = await embedRes.json().catch(() => null);
        const dims = Array.isArray(data?.data?.[0]?.embedding) ? data.data[0].embedding.length : null;
        return NextResponse.json({ valid: true, method: "embeddings", dimensions: dims });
      }
      if (embedRes.status === 401 || embedRes.status === 403) {
        return NextResponse.json({ valid: false, error: "API key unauthorized" });
      }
      // Do NOT echo upstream response body back to the caller — that was
      // the blind-SSRF amplification (probe metadata via /embeddings and
      // read it in the JSON error).
      return NextResponse.json({
        valid: false,
        error: `Embeddings request failed (${embedRes.status})`,
        method: "embeddings",
        status: embedRes.status,
      });
    }

    // Anthropic Compatible Validation
    if (type === "anthropic-compatible") {
      let normalizedBase = baseUrl.trim().replace(/\/$/, "");
      if (normalizedBase.endsWith("/messages")) {
        normalizedBase = normalizedBase.slice(0, -9);
      }

      const modelsUrl = `${normalizedBase}/models`;
      let res;
      try {
        res = await guardedFetch(modelsUrl, {
          method: "GET",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Authorization": `Bearer ${apiKey}`
          }
        });
      } catch (err) {
        if (err instanceof OutboundUrlGuardError) return blockedResponse(err);
        throw err;
      }

      if (res.ok) return NextResponse.json({ valid: true });

      // Auth errors - no point trying chat fallback
      if (res.status === 401 || res.status === 403) {
        return NextResponse.json({ valid: false, error: "API key unauthorized" });
      }

      // Fallback: try chat/completions if modelId provided
      if (modelId) {
        let chatRes;
        try {
          chatRes = await guardedFetch(`${normalizedBase}/chat/completions`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
              model: modelId,
              messages: [{ role: "user", content: "ping" }],
              max_tokens: 1
            })
          });
        } catch (err) {
          if (err instanceof OutboundUrlGuardError) return blockedResponse(err);
          throw err;
        }
        if (chatRes.ok) {
          return NextResponse.json({ valid: true, method: "chat" });
        }
        return NextResponse.json({
          valid: false,
          error: getChatErrorMessage(chatRes.status),
          method: "chat",
          status: chatRes.status,
        });
      }

      return NextResponse.json({ valid: false, error: getModelsErrorMessage(res.status), status: res.status });
    }

    // OpenAI Compatible Validation (Default)
    const modelsUrl = `${baseUrl.replace(/\/$/, "")}/models`;
    let res;
    try {
      res = await guardedFetch(modelsUrl, {
        headers: { "Authorization": `Bearer ${apiKey}` },
      });
    } catch (err) {
      if (err instanceof OutboundUrlGuardError) return blockedResponse(err);
      throw err;
    }

    if (res.ok) return NextResponse.json({ valid: true });

    // Auth errors - no point trying chat fallback
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ valid: false, error: "API key unauthorized" });
    }

    // Fallback: try chat/completions if modelId provided
    if (modelId) {
      let chatRes;
      try {
        chatRes = await guardedFetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1
          })
        });
      } catch (err) {
        if (err instanceof OutboundUrlGuardError) return blockedResponse(err);
        throw err;
      }
      if (chatRes.ok) {
        return NextResponse.json({ valid: true, method: "chat" });
      }
      return NextResponse.json({
        valid: false,
        error: getChatErrorMessage(chatRes.status),
        method: "chat",
        status: chatRes.status,
      });
    }

    return NextResponse.json({ valid: false, error: getModelsErrorMessage(res.status), status: res.status });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.error("Error validating provider node:", {
      message: error.message,
      cause: error.cause,
      code: error.cause?.code,
      userMessage: errorMessage
    });
    return NextResponse.json({
      valid: false,
      error: errorMessage
    }, { status: 500 });
  }
}
