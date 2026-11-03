import { NextResponse } from "next/server";
import { canModifySecurityCriticalSettings } from "@/lib/settings/settingsPatchAuth";
import { dispatchWebhookEvent, listWebhooks } from "@/lib/webhooks/index.js";

// Sends a signed test.ping to one destination, even if it does not subscribe
// to test.ping. Disabled destinations are not contacted.
export async function POST(request, { params }) {
  if (!await canModifySecurityCriticalSettings(request)) {
    return NextResponse.json({ error: "Dashboard session required" }, { status: 403 });
  }
  const { id } = await params;
  const hook = (await listWebhooks()).find((h) => h.id === id);
  if (!hook) return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  if (hook.enabled !== true) return NextResponse.json({ error: "Webhook is disabled" }, { status: 409 });
  const [result] = await dispatchWebhookEvent("test.ping", { message: "DurinDoor webhook test" }, {
    hooks: [{ ...hook, events: ["test.ping"] }]
  });
  return NextResponse.json({ result: result ?? null });
}
