import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

function normalizeExpiresAt(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return { error: "expiresAt must be an ISO date string or null" };
  const date = new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return { error: "expiresAt must be a valid date" };
  if (time <= Date.now()) return { error: "expiresAt must be in the future" };
  return date.toISOString();
}

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys
export async function GET() {
  try {
    const keys = await getApiKeys();
    return NextResponse.json({ keys });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  try {
    const body = await request.json();
    const { allowedCombos } = body;
    const name = typeof body.name === "string" ? body.name.trim() : "";

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const expiresAt = normalizeExpiresAt(body.expiresAt);
    if (expiresAt?.error) {
      return NextResponse.json({ error: expiresAt.error }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId, allowedCombos || [], expiresAt);

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      allowedCombos: apiKey.allowedCombos,
      expiresAt: apiKey.expiresAt,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
