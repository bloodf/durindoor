import { NextResponse } from "next/server";
import { clearModelTestResults, getModelTestResults, saveModelTestResults } from "@/lib/db/repos/modelTestResultsRepo.js";
import { parseModelTestResultKeys, parseModelTestResults } from "@/shared/utils/modelTestResults.js";

export const dynamic = "force-dynamic";

// Access control: /api/models is a management prefix in src/dashboardGuard.js.

// GET /api/models/test-results - persisted last-test status per connection and model
export async function GET() {
  try {
    return NextResponse.json({ results: await getModelTestResults() });
  } catch (error) {
    console.error("Error fetching model test results:", error);
    return NextResponse.json({ error: "Failed to fetch model test results" }, { status: 500 });
  }
}

// POST /api/models/test-results  body: { results: { "<connection>|alias/modelId": { state, error } } }
export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = parseModelTestResults(body?.results);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    await saveModelTestResults(parsed.entries);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving model test results:", error);
    return NextResponse.json({ error: "Failed to save model test results" }, { status: 500 });
  }
}

// DELETE /api/models/test-results  body: { models: ["<connection>|alias/modelId", ...] }
export async function DELETE(request) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = parseModelTestResultKeys(body?.models);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    await clearModelTestResults(parsed.keys);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error clearing model test results:", error);
    return NextResponse.json({ error: "Failed to clear model test results" }, { status: 500 });
  }
}
