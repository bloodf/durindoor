import { NextResponse } from "next/server";
import { getCustomModels, addCustomModel, updateCustomModel, deleteCustomModel } from "@/lib/localDb";
import { isNumber, isRecord, isString } from "@/shared/utils/typeChecks.js";

export const dynamic = "force-dynamic";

// Accept upstream token-limit names through the existing validated capability store.
function tokenCapabilities(body) {
  const input = body.max_input_tokens ?? body.maxInputTokens ?? body.context_length ?? body.contextLength ?? body.contextWindow;
  const output = body.max_output_tokens ?? body.maxOutputTokens;
  const limits = {};
  const number = (value) => isNumber(value) || isString(value) ? Number(value) : NaN;
  if (input !== undefined && input !== null && input !== "") {
    limits.contextWindow = number(input);
    limits.maxInput = number(input);
  }
  if (output !== undefined && output !== null && output !== "") limits.maxOutput = number(output);
  if (!Object.keys(limits).length || (body.capabilities != null && !isRecord(body.capabilities))) return body.capabilities;
  return { ...limits, ...body.capabilities };
}

// GET /api/models/custom - List all custom models
export async function GET() {
  try {
    const models = await getCustomModels();
    return NextResponse.json({ models });
  } catch (error) {
    console.log("Error fetching custom models:", error);
    return NextResponse.json({ error: "Failed to fetch custom models" }, { status: 500 });
  }
}

// POST /api/models/custom - Add custom model
export async function POST(request) {
  try {
    const body = await request.json();
    const { providerAlias, id, type, name } = body;
    const capabilities = tokenCapabilities(body);
    if (!providerAlias || !id) {
      return NextResponse.json({ error: "providerAlias and id required" }, { status: 400 });
    }
    const added = await addCustomModel({ providerAlias, id, type: type || "llm", name, capabilities });
    if (!added) {
      return NextResponse.json({ error: "Custom model already exists" }, { status: 409 });
    }
    return NextResponse.json({ success: true, model: added });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    console.log("Error adding custom model:", error);
    return NextResponse.json({ error: error.message || "Failed to add custom model" }, { status: error.status || 500 });
  }
}

// PATCH /api/models/custom - Edit custom model capabilities
export async function PATCH(request) {
  try {
    const body = await request.json();
    const { providerAlias, id, type, name } = body;
    const capabilities = tokenCapabilities(body);
    if (!providerAlias || !id) {
      return NextResponse.json({ error: "providerAlias and id required" }, { status: 400 });
    }
    const updated = await updateCustomModel({ providerAlias, id, type: type || "llm", name, capabilities });
    if (!updated) {
      return NextResponse.json({ error: "Custom model not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, model: updated });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    console.log("Error updating custom model:", error);
    return NextResponse.json({ error: error.message || "Failed to update custom model" }, { status: error.status || 500 });
  }
}

// DELETE /api/models/custom?providerAlias=xxx&id=yyy&type=zzz
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerAlias = searchParams.get("providerAlias");
    const id = searchParams.get("id");
    const type = searchParams.get("type") || "llm";
    if (!providerAlias || !id) {
      return NextResponse.json({ error: "providerAlias and id required" }, { status: 400 });
    }
    await deleteCustomModel({ providerAlias, id, type });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting custom model:", error);
    return NextResponse.json({ error: "Failed to delete custom model" }, { status: 500 });
  }
}
