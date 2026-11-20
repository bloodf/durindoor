import { NextResponse } from "next/server";
import { isOperatorRequest } from "@/dashboardGuard";
import { isString } from "@/shared/utils/typeChecks";
import { pingModelByKind } from "./ping";
import { SUPPORTED_CAPABILITY_CHECKS, isSupportedCapabilityCheck } from "./capabilityCheck";

// POST /api/models/test - Ping a single model via internal completions or embeddings
//
// `check` turns the same probe into a one-model capability check: the request
// still goes through the ordinary chat operation, but it carries a tool
// definition so the response shows whether the provider really accepts tools
// (see ./capabilityCheck.js). It is opt-in, it costs exactly one upstream
// request, and it is never scheduled, retried or swept.
export async function POST(request) {
  try {
    const { model, kind, connectionId, check } = await request.json();
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
    if (check !== undefined) {
      if (!isString(check) || !check.trim()) {
        return NextResponse.json({ error: "check must be a non-empty string" }, { status: 400 });
      }
      if (!isSupportedCapabilityCheck(check)) {
        return NextResponse.json({
          error: `Unsupported capability check "${check.trim()}". Supported: ${SUPPORTED_CAPABILITY_CHECKS.join(", ")}`,
        }, { status: 400 });
      }
      // A capability check is one normal provider operation. Only the chat
      // operation can carry a tool definition, so any other kind is refused
      // instead of being answered by a different route.
      if ((kind || "llm") !== "llm") {
        return NextResponse.json({ error: "Capability checks require the llm kind" }, { status: 400 });
      }
    }
    const result = await pingModelByKind(model, kind || "llm", undefined, connectionId?.trim(), { check: check?.trim() });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
