import { NextResponse } from "next/server";
import { isOperatorRequest } from "@/dashboardGuard";
import { isString } from "@/shared/utils/typeChecks";
import { pingModelByKind } from "./ping";

// POST /api/models/test - Ping a single model via internal completions or embeddings
export async function POST(request) {
  try {
    const { model, kind, connectionId } = await request.json();
    if (!model) return NextResponse.json({ error: "Model required" }, { status: 400 });
    if (connectionId !== undefined) {
      if (!isString(connectionId) || !connectionId.trim()) {
        return NextResponse.json({ error: "connectionId must be a non-empty string" }, { status: 400 });
      }
      // The internal probe runs with the CLI token (unscoped), so pinning a
      // connection would bypass an API key's account allow-list. Only operators
      // (session, CLI token, open local dashboard) may pin; chat.js still checks
      // the connection is active and belongs to the model's provider.
      if (!(await isOperatorRequest(request))) {
        return NextResponse.json({ error: "connectionId requires an operator session" }, { status: 403 });
      }
    }
    const result = await pingModelByKind(model, kind || "llm", undefined, connectionId?.trim());
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
