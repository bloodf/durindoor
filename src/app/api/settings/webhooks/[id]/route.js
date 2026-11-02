import { NextResponse } from "next/server";
import { canModifySecurityCriticalSettings } from "@/lib/settings/settingsPatchAuth";
import { WebhookValidationError, deleteWebhook, toPublicWebhook, updateWebhook } from "@/lib/webhooks/index.js";

const forbidden = () => NextResponse.json({ error: "Dashboard session required" }, { status: 403 });

export async function PATCH(request, { params }) {
  if (!await canModifySecurityCriticalSettings(request)) return forbidden();
  const { id } = await params;
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const hook = await updateWebhook(id, body);
    if (!hook) return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
    return NextResponse.json({ webhook: toPublicWebhook(hook) });
  } catch (error) {
    if (error instanceof WebhookValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "Failed to update webhook" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  if (!await canModifySecurityCriticalSettings(request)) return forbidden();
  const { id } = await params;
  const deleted = await deleteWebhook(id);
  return deleted ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "Webhook not found" }, { status: 404 });
}
