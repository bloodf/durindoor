import { NextResponse } from "next/server";
import { getInstances, createInstance } from "@/lib/localDb";
import { deriveOauthStatus } from "@/lib/mcp/gateway/oauthStatus";
import { mergeOauthClientConfig } from "@/lib/mcp/gateway/oauthClientConfig";
import { assertOutboundUrlAllowed, OutboundUrlGuardError } from "open-sse/utils/outboundUrlGuard.js";
import { sanitizeInstanceHeaders } from "@/lib/mcp/gateway/instanceHeaders";
import { isObject, isString } from "@/shared/utils/typeChecks.js";

export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9-]{2,40}$/;

const VALID_KINDS = new Set(["http", "sse", "npx", "python", "docker", "command"]);
const VALID_TRANSPORTS = new Set(["http", "sse", "stdio"]);

function stripSecrets(inst) {
  if (!inst) return inst;
  const { headers: _h, env: _e, oauthTokens: _o, providerConnectionId: _p, ...out } = inst;
  void _h;void _e;void _p;
  out.oauthStatus = deriveOauthStatus(!!inst.oauth, _o);
  out.oauthClientConfigured = !!(_o && _o.client && _o.client.clientId);
  // Expose only whether a connection is referenced, never the id (which is
  // an internal foreign key and could be probed by an unauthenticated UI
  // surface for enumeration).
  out.hasProviderConnection = isString(inst.providerConnectionId) && inst.providerConnectionId.length > 0;
  return out;
}

function validatePayload(body) {
  const errors = [];
  if (!body.slug || !SLUG_RE.test(body.slug)) {
    errors.push("slug must match ^[a-z0-9-]{2,40}$");
  }
  if (body.slug && body.slug.includes("__")) {
    errors.push("slug cannot contain __ (reserved as tool-name separator)");
  }
  if (!body.kind || !VALID_KINDS.has(body.kind)) {
    errors.push(`kind must be one of: ${[...VALID_KINDS].join(", ")}`);
  }
  const transport = body.transport || (body.kind === "http" || body.kind === "sse" ? body.kind : "stdio");
  if (!VALID_TRANSPORTS.has(transport)) {
    errors.push(`transport must be one of: ${[...VALID_TRANSPORTS].join(", ")}`);
  }
  if (transport === "http" || transport === "sse") {
    if (!body.url) errors.push("url is required for http/sse transport");
  } else {
    if (!body.command) errors.push("command is required for stdio transport");
  }
  return errors;
}

export async function GET() {
  try {
    const list = await getInstances();
    return NextResponse.json({ instances: list.map(stripSecrets) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const errs = validatePayload(body);
    if (errs.length) return NextResponse.json({ error: errs.join("; ") }, { status: 400 });

    // SSRF guard: instance.url becomes the outbound target for
    // mcpRequest() and oauthRefresh. Validate BEFORE we persist anything
    // — block-metadata is the default (LAN/loopback allowed; metadata
    // link-local blocked); operators can tighten to public-only via
    // OMNIROUTE_ALLOW_LOCAL_PROVIDER_URLS=false.
    if (body.url) {
      try {
        assertOutboundUrlAllowed(body.url);
      } catch (err) {
        if (err instanceof OutboundUrlGuardError) {
          console.log("MCP instance URL blocked by SSRF guard:", err?.message, "url=", err?.url);
          return NextResponse.json({ error: "URL not allowed", blocked: true }, { status: 403 });
        }
        throw err;
      }
    }

    // Sanitize caller-supplied headers against a strict allowlist. A
    // previous version let callers set Authorization/Cookie/Proxy-
    // Authorization/X-* which would be forwarded to the upstream on every
    // request AND on any cross-origin redirect.
    if (body.headers !== undefined) {
      body.headers = sanitizeInstanceHeaders(body.headers);
    }

    // providerConnectionId is a server-side shortcut for MCP backends whose
    // auth is a stored provider key (z.ai today; future providers can register
    // here). The server resolves the secret at HTTP time — the API key never
    // appears in the response, the stored row, or any client-supplied field.
    // Currently only the z.ai MCP endpoint is supported; any other URL/canonical
    // combination is rejected to avoid leaking the key to an unexpected host.
    if (body.providerConnectionId != null && body.providerConnectionId !== "") {
      const { resolveProviderId } = await import("@/shared/constants/providers.js");
      const { getProviderConnectionById } = await import("@/lib/db/repos/connectionsRepo.js");
      const conn = await getProviderConnectionById(body.providerConnectionId);
      if (!conn) return NextResponse.json({ error: "providerConnectionId not found" }, { status: 404 });
      if (conn.isActive === false) {
        return NextResponse.json({ error: "providerConnection is paused" }, { status: 400 });
      }
      const canonical = resolveProviderId(conn.provider);
      if (canonical !== "zai") {
        return NextResponse.json({ error: "Only the z.ai provider can be referenced as a providerConnectionId" }, { status: 400 });
      }
      if (!(body.url || "").startsWith("https://api.z.ai/api/mcp/")) {
        return NextResponse.json({ error: "URL must be the z.ai MCP endpoint (https://api.z.ai/api/mcp/...)" }, { status: 400 });
      }
    }

    // Fold any manually-entered OAuth client credentials into oauthTokens.
    const oauthTokens = mergeOauthClientConfig(null, body);
    if (oauthTokens) body.oauthTokens = oauthTokens;
    const inst = await createInstance(body);
    return NextResponse.json({ instance: stripSecrets(inst) }, { status: 201 });
  } catch (e) {
    const err = e && isObject(e) ? e : {};
    if (err?.code === "DUPLICATE_SLUG" || /already exists/i.test(err.message || "")) {
      return NextResponse.json({ error: err.message || "slug already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: err.message || String(e) }, { status: 500 });
  }
}