import { NextResponse } from "next/server";
import { getInstanceById, updateInstance, deleteInstance } from "@/lib/localDb";
import { deriveOauthStatus } from "@/lib/mcp/gateway/oauthStatus";
import { mergeOauthClientConfig } from "@/lib/mcp/gateway/oauthClientConfig";
import { assertOutboundUrlAllowed, OutboundUrlGuardError } from "open-sse/utils/outboundUrlGuard.js";
import { sanitizeInstanceHeaders } from "@/lib/mcp/gateway/instanceHeaders";
import { isObject } from "../../../../../shared/utils/typeChecks.js";

export const dynamic = "force-dynamic";

function stripSecrets(inst) {
  if (!inst) return inst;
  const { headers: _h, env: _e, oauthTokens: _o, ...out } = inst;
  void _h;void _e;
  out.oauthStatus = deriveOauthStatus(!!inst.oauth, _o);
  out.oauthClientConfigured = !!(_o && _o.client && _o.client.clientId);
  return out;
}

const SLUG_RE = /^[a-z0-9-]{2,40}$/;

function validatePatch(body) {
  const errs = [];
  if (body.slug !== undefined) {
    if (!SLUG_RE.test(body.slug)) errs.push("slug must match ^[a-z0-9-]{2,40}$");
    if (body.slug.includes("__")) errs.push("slug cannot contain __");
  }
  return errs;
}

export async function GET(_request, context) {
  try {
    const { id } = await context.params;
    const inst = await getInstanceById(id);
    if (!inst) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ instance: stripSecrets(inst) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(request, context) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const errs = validatePatch(body);
    if (errs.length) return NextResponse.json({ error: errs.join("; ") }, { status: 400 });

    // SSRF guard on URL update — see the matching block on POST.
    if (body.url !== undefined && body.url !== null && body.url !== "") {
      try {
        assertOutboundUrlAllowed(body.url);
      } catch (err) {
        if (err instanceof OutboundUrlGuardError) {
          console.log("MCP instance URL blocked by SSRF guard (update):", err?.message, "url=", err?.url);
          return NextResponse.json({ error: "URL not allowed", blocked: true }, { status: 403 });
        }
        throw err;
      }
    }

    // Sanitize caller-supplied headers on update too (allowlist).
    if (body.headers !== undefined) {
      body.headers = sanitizeInstanceHeaders(body.headers);
    }

    // Fold any manually-entered OAuth client credentials into oauthTokens,
    // merging with (not clobbering) whatever token material is already stored.
    const existing = await getInstanceById(id);
    const oauthTokens = mergeOauthClientConfig(existing?.oauthTokens, body);
    if (oauthTokens) body.oauthTokens = oauthTokens;
    const inst = await updateInstance(id, body);
    if (!inst) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ instance: stripSecrets(inst) });
  } catch (e) {
    const err = e && isObject(e) ? e : {};
    if (err?.code === "DUPLICATE_SLUG" || /already exists/i.test(err.message || "")) {
      return NextResponse.json({ error: err.message || "slug already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: err.message || String(e) }, { status: 500 });
  }
}

export async function DELETE(_request, context) {
  try {
    const { id } = await context.params;
    const ok = await deleteInstance(id);
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}