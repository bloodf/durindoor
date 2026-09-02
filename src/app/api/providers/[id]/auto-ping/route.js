import { NextResponse } from "next/server";
import { setProviderConnectionAutoPing } from "@/lib/localDb";
import { notifyQuotaAutoPingSettingChanged } from "@/shared/services/quotaAutoPing";

// Mutate one connection entry atomically. The provider and settings key are
// derived from the stored connection so clients cannot write another object's
// auto-ping map or bypass OAuth/provider eligibility.
import { isBoolean } from "../../../../../shared/utils/typeChecks.js";
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    if (!isBoolean(body?.enabled)) {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }

    const result = await setProviderConnectionAutoPing(id, body.enabled);
    if (!result) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

    notifyQuotaAutoPingSettingChanged(result.provider, result.connectionId, result.enabled, result.config);
    return NextResponse.json(result);
  } catch (error) {
    if (error?.code === "AUTO_PING_INELIGIBLE") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.log("Error updating connection auto-ping:", error);
    return NextResponse.json({ error: "Failed to update connection auto-ping" }, { status: 500 });
  }
}