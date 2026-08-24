import { NextResponse } from "next/server";
import { reorderProviderConnectionsByIds } from "@/lib/db";
import { isString } from "@/shared/utils/typeChecks.js";

export const dynamic = "force-dynamic";

/**
 * PUT /api/providers/reorder — atomically persist a full connection order.
 * Port companion for decolua/9router#2558 (reorder-by-availability button):
 * per-connection PUTs race under `reorderInTx` normalization, so the whole
 * order is applied in ONE DB transaction here.
 * Body: { providerId: string, orderedIds: string[] }.
 * orderedIds MUST be exactly the provider's connection ids (no dups, none
 * missing) or nothing is persisted.
 */
export async function PUT(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { providerId, orderedIds } = body ?? {};
  if (!isString(providerId) || !providerId) {
    return NextResponse.json({ error: "providerId is required" }, { status: 400 });
  }
  if (!Array.isArray(orderedIds) || orderedIds.some((id) => !isString(id))) {
    return NextResponse.json({ error: "orderedIds must be an array of strings" }, { status: 400 });
  }

  try {
    await reorderProviderConnectionsByIds(providerId, orderedIds);
  } catch {
    return NextResponse.json(
      { error: "orderedIds must match the provider's connection set exactly (no duplicates, none missing)" },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true });
}