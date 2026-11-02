import { NextResponse } from "next/server";
import { setProviderConnectionAutoPing } from "@/lib/localDb";
import { notifyQuotaAutoPingSettingChanged } from "@/shared/services/quotaAutoPing";
import { isOperatorRequest } from "@/dashboardGuard";
import { validatePingSchedule } from "@/shared/services/quotaPingSchedule";

// Mutate one connection entry atomically. The provider and settings key are
// derived from the stored connection so clients cannot write another object's
// auto-ping map or bypass OAuth/provider eligibility.
import { isBoolean, isObject } from "../../../../../shared/utils/typeChecks.js";
export async function PATCH(request, { params }) {
  try {
    // Enabling pings spends upstream quota: operator sessions only, not inference API keys.
    if (!await isOperatorRequest(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { id } = await params;
    const body = await request.json();
    // `schedule` is optional: omitted keeps the stored anchored schedule. A
    // schedule-only write may omit `enabled` to keep the reactive flag.
    const hasSchedule = body !== null && isObject(body) && Object.hasOwn(body, "schedule");
    if (!isBoolean(body?.enabled) && !(hasSchedule && body.enabled === undefined)) {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    let schedule;
    if (hasSchedule) {
      const validated = validatePingSchedule(body.schedule);
      if (validated.error) return NextResponse.json({ error: validated.error }, { status: 400 });
      schedule = validated.schedule;
    }

    const result = hasSchedule ?
    await setProviderConnectionAutoPing(id, body.enabled, schedule) :
    await setProviderConnectionAutoPing(id, body.enabled);
    if (!result) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

    notifyQuotaAutoPingSettingChanged(result.provider, result.connectionId, result.enabled || Boolean(result.schedule), result.config);
    return NextResponse.json(result);
  } catch (error) {
    if (error?.code === "AUTO_PING_INELIGIBLE") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.log("Error updating connection auto-ping:", error);
    return NextResponse.json({ error: "Failed to update connection auto-ping" }, { status: 500 });
  }
}
