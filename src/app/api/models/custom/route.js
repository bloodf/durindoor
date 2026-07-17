import { NextResponse } from "next/server";
import { getCustomModels, addCustomModel, updateCustomModel, deleteCustomModel } from "@/models";

export const dynamic = "force-dynamic";

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
    const { providerAlias, id, type, name, capabilities } = await request.json();
    if (!providerAlias || !id) {
      return NextResponse.json({ error: "providerAlias and id required" }, { status: 400 });
    }
    const added = await addCustomModel({ providerAlias, id, type: type || "llm", name, capabilities });
    return NextResponse.json({ success: true, added });
  } catch (error) {
    console.log("Error adding custom model:", error);
    return NextResponse.json({ error: error.message || "Failed to add custom model" }, { status: error.status || 500 });
  }
}

// PATCH /api/models/custom - Edit custom model capabilities
export async function PATCH(request) {
  try {
    const { providerAlias, id, type, name, capabilities } = await request.json();
    if (!providerAlias || !id) {
      return NextResponse.json({ error: "providerAlias and id required" }, { status: 400 });
    }
    const updated = await updateCustomModel({ providerAlias, id, type: type || "llm", name, capabilities });
    if (!updated) {
      return NextResponse.json({ error: "Custom model not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, updated });
  } catch (error) {
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
