import { NextResponse } from "next/server";
import { guardedProbeFetch, OutboundUrlGuardError } from "open-sse/utils/outboundUrlGuard.js";

// Guarded fetch wrapper used for all outbound probes in this route.
// - applies the outbound-URL SSRF guard BEFORE the socket opens
// - forces redirect:"manual" so a 3xx cannot bounce the probe to metadata
// - throws OutboundUrlGuardError on policy rejection (caller maps to 403)
const guardedFetch = (url, options, timeout = 10000) => {
  return guardedProbeFetch(
    url,
    {
      ...options,
      signal: AbortSignal.timeout(timeout),
    },
  );
};

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

    if (!baseUrl || !apiKey) {
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
