import { randomBytes } from "node:crypto";
import { isString } from "../../../shared/utils/typeChecks.js";

/** 32 random bytes as hex — one secret per relay deployment. */
export function generateRelaySecret() {
  return randomBytes(32).toString("hex");
}

/**
 * Constant-time compare + auth gate embedded in every deployed relay.
 * Empty EXPECTED_SECRET keeps pre-secret relays (and unit fixtures) open.
 */
function relayAuthHelpers(relaySecret) {
  const expected = JSON.stringify(isString(relaySecret) ? relaySecret : "");
  return `
const EXPECTED_SECRET = ${expected};

function relaySecretsMatch(expected, provided) {
  const enc = new TextEncoder();
  const a = enc.encode(expected);
  const b = enc.encode(provided);
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function assertRelaySecret(requestLike) {
  if (!EXPECTED_SECRET) return null;
  const provided = requestLike.headers.get("x-relay-secret") || "";
  if (!relaySecretsMatch(EXPECTED_SECRET, provided)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return null;
}
`;
}

/** Cloudflare Worker module source for a relay with the given deploy secret. */
export function buildRelayWorkerCode(relaySecret = "") {
  return `
${relayAuthHelpers(relaySecret)}
export default {
  async fetch(request, env, ctx) {
    const denied = assertRelaySecret(request);
    if (denied) return denied;

    const target = request.headers.get("x-relay-target");
    const relayPath = request.headers.get("x-relay-path") || "/";

    if (!target) {
      return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const targetUrl = target.replace(/\\/$/, "") + relayPath;
    const newRequestInit = {
      method: request.method,
      headers: new Headers(request.headers),
      redirect: "manual",
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      newRequestInit.body = request.body;
      newRequestInit.duplex = "half";
    }

    newRequestInit.headers.delete("x-relay-target");
    newRequestInit.headers.delete("x-relay-path");
    newRequestInit.headers.delete("x-relay-secret");
    newRequestInit.headers.delete("host");

    try {
      /** Keep redirect handling portable across workerd and Fetch runtimes. */
      const response = await fetch(targetUrl, newRequestInit);
      if (response.status >= 300 && response.status < 400) {
        throw new Error("Upstream redirects are not allowed");
      }
      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }
  },
};
`;
}

/** Vercel Edge Function source for a relay with the given deploy secret. */
export function buildRelayFunctionCode(relaySecret = "") {
  return `
export const config = { runtime: "edge" };

${relayAuthHelpers(relaySecret)}
export default async function handler(req) {
  const denied = assertRelaySecret(req);
  if (denied) return denied;

  const target = req.headers.get("x-relay-target");
  const relayPath = req.headers.get("x-relay-path") || "/";
  if (!target) {
    return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const targetUrl = target.replace(/\\/$/, "") + relayPath;

  // Build headers from entries() into a plain object instead of
  // new Headers(req.headers): the Vercel edge runtime normalizes casing
  // and duplicate keys on a Headers instance, which some providers reject.
  const rawHeaders = {};
  for (const [key, value] of req.headers.entries()) rawHeaders[key] = value;
  delete rawHeaders["x-relay-target"];
  delete rawHeaders["x-relay-path"];
  delete rawHeaders["x-relay-secret"];
  delete rawHeaders["host"];

  try {
    /** Keep redirect handling explicit instead of relying on runtime-specific fetch errors. */
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: rawHeaders,
      body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
      redirect: "manual",
      duplex: "half",
    });
    if (response.status >= 300 && response.status < 400) {
      throw new Error("Upstream redirects are not allowed");
    }

    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}
`;
}
