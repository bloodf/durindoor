import { NextResponse } from "next/server";
import { canModifySecurityCriticalSettings } from "@/lib/settings/settingsPatchAuth";
import { WEBHOOK_EVENTS, WebhookValidationError, createWebhook, listWebhooks, toPublicWebhook } from "@/lib/webhooks/index.js";

const NO_STORE = { "Cache-Control": "no-store" };

// Operator webhooks (#1118): dashboard JWT or machine-bound CLI token only.
// An inference API key cannot add an outbound destination or read history.
export async function GET(request) {
  if (!await canModifySecurityCriticalSettings(request)) {
    return NextResponse.json({ error: "Dashboard session required" }, { status: 403 });
  }
  const hooks = await listWebhooks();
  return NextResponse.json({ events: WEBHOOK_EVENTS, webhooks: hooks.map(toPublicWebhook) }, { headers: NO_STORE });
}

export async function POST(request) {
  if (!await canModifySecurityCriticalSettings(request)) {
    return NextResponse.json({ error: "Dashboard session required" }, { status: 403 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const hook = await createWebhook(body);
    // The signing secret is returned exactly once, at creation.
    return NextResponse.json({ webhook: toPublicWebhook(hook), secret: hook.secret }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof WebhookValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "Failed to create webhook" }, { status: 500 });
  }
}
