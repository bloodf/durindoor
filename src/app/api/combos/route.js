import { NextResponse } from "next/server";
import { getCombos, createCombo, getComboByName, ComboMemberError, validateConnectionIds, ConnectionGroupValidationError } from "@/lib/localDb";
import { parseJsonBody } from "@/shared/utils/parseJsonBody";
import { normalizeComboCapabilities } from "open-sse/providers/capabilities.js";

const MAX_ALLOWLIST_IDS = 500;

async function parseAllowedConnectionIds(body) {
  if (!Object.prototype.hasOwnProperty.call(body, "allowedConnectionIds")) return undefined;
  if (!Array.isArray(body.allowedConnectionIds) || body.allowedConnectionIds.length > MAX_ALLOWLIST_IDS) {
    throw new ConnectionGroupValidationError(`allowedConnectionIds must be an array with at most ${MAX_ALLOWLIST_IDS} ids`);
  }
  return validateConnectionIds(body.allowedConnectionIds);
}
export const dynamic = "force-dynamic";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

// GET /api/combos - Get all combos
export async function GET() {
  try {
    const combos = await getCombos();
    return NextResponse.json({ combos });
  } catch (error) {
    console.log("Error fetching combos:", error);
    return NextResponse.json({ error: "Failed to fetch combos" }, { status: 500 });
  }
}

// POST /api/combos - Create new combo
export async function POST(request) {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  try {
    const { name, models, members, kind, capabilities } = parsed.body;
    const allowedConnectionIds = await parseAllowedConnectionIds(parsed.body);

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Validate name format
    if (!VALID_NAME_REGEX.test(name)) {
      return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
    }

    const normalizedCapabilities = normalizeComboCapabilities(capabilities);
    if (!normalizedCapabilities.ok) {
      return NextResponse.json({ error: normalizedCapabilities.error }, { status: 400 });
    }

    // Check if name already exists
    const existing = await getComboByName(name);
    if (existing) {
      return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
    }

    const combo = await createCombo({ name, models: models || [], members, kind: kind || null, capabilities: normalizedCapabilities.capabilities, allowedConnectionIds });

    return NextResponse.json(combo, { status: 201 });
  } catch (error) {
    if (error instanceof ComboMemberError || error instanceof ConnectionGroupValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.log("Error creating combo:", error);
    return NextResponse.json({ error: "Failed to create combo" }, { status: 500 });
  }
}
