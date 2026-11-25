import { createHash } from "node:crypto";
import registry from "open-sse/providers/registry/index.js";
import { isBoolean, isObject, isString } from "@/shared/utils/typeChecks.js";
import { NextResponse } from "next/server";
import { hasValidCliToken, hasValidToken, isLocalRequest } from "@/dashboardGuard";
import { hasExactRequestOrigin } from "@/lib/auth/requestOrigin";
import { createChatGptPlanAccounts } from "@/lib/oauth/chatgptPlanAccounts";
import { createChatGptPlanEnrollment } from "@/lib/oauth/chatgptPlanEnrollment";
import { createProviderConnection, getProviderConnectionById, compareAndSwapChatGptPlanSelection } from "@/lib/db/repos/connectionsRepo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
let enrollment;
function service() {
  if (!enrollment) enrollment = createChatGptPlanEnrollment({
    accounts: createChatGptPlanAccounts({ fetchAdapter: (url, options) => fetch(url, options) }),
    repository: { get: getProviderConnectionById, create: createProviderConnection, bind: compareAndSwapChatGptPlanSelection },
  });
  return enrollment;
}

export async function POST(request) {
  // Require an actual session or machine token, even on an open dashboard.
  if (!registry.some((provider) => provider.id === "chatgpt-plan") ||
      process.env.DURINDOOR_CHATGPT_PLAN_ENROLLMENT !== "1" || !isLocalRequest(request) ||
      !hasExactRequestOrigin(request)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const cli = await hasValidCliToken(request);
  if (!cli && !await hasValidToken(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const credential = cli ? request.headers.get("x-9r-cli-token") : request.cookies.get("auth_token")?.value;
  const actor = createHash("sha256").update(credential).digest("hex");
  try {
    const body = await request.json();
    if (!isObject(body) || Array.isArray(body)) throw new Error("invalid_request");
    const fields = {
      create: ["action", "name"], start: ["action", "connectionId"],
      status: ["action", "attemptId"], cancel: ["action", "attemptId"],
      signOut: ["action", "connectionId", "localOnly"],
    };
    if (!Object.hasOwn(fields, body.action) || Object.keys(body).some((key) => !fields[body.action].includes(key))) throw new Error("invalid_request");
    if (["start", "signOut"].includes(body.action) && (!isString(body.connectionId) || !body.connectionId)) throw new Error("invalid_request");
    if (["status", "cancel"].includes(body.action) && (!isString(body.attemptId) || !body.attemptId)) throw new Error("invalid_request");
    const api = service();
    let result;
    switch (body.action) {
      case "create": {
        if (!isString(body.name) || !body.name.trim() || body.name.length > 100) throw new Error("invalid_request");
        const row = await api.create(body.name.trim());
        result = { connectionId: row.id };
        break;
      }
      case "start": result = await api.start(body.connectionId, actor); break;
      case "status": result = api.status(body.attemptId, actor); break;
      case "cancel": api.cancel(body.attemptId, actor); result = { cancelled: true }; break;
      case "signOut":
        if (body.localOnly !== undefined && !isBoolean(body.localOnly)) throw new Error("invalid_request");
        result = await api.signOut(body.connectionId, body.localOnly === true); break;
      default: throw new Error("invalid_request");
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Enrollment request failed" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
