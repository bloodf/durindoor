// SSE message POST endpoint: client sends JSON-RPC here, we route the
// response back over the open SSE stream identified by sessionId.
//
// Auth: a gateway key bound to the session. A session opened with `?key=` may
// POST with the session id alone; the stored key is re-validated every time.

import { NextResponse } from "next/server";
import { handleJsonRpc } from "@/lib/mcp/gateway/handler";
import { getSession, getSessionQueryKey } from "@/lib/mcp/gateway/sseSessions";
import { validateGatewayKey } from "@/lib/localDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const url = new URL(request.url);
  const sid = url.searchParams.get("sessionId");
  if (!sid) return NextResponse.json({ error: "missing sessionId" }, { status: 400 });
  const authorization = request.headers.get("Authorization");
  const sentKey = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : request.headers.get("x-api-key") || request.headers.get("x-goog-api-key") || url.searchParams.get("key");
  const rawKey = sentKey || getSessionQueryKey(sid);
  const key = rawKey ? await validateGatewayKey(rawKey) : null;
  if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const session = getSession(sid);
  if (!session || session.keyId !== key.id) return NextResponse.json({ error: "session not found" }, { status: 404 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "parse error" }, { status: 400 });
  }

  // The handler authenticates from the request, so hand it the session's key
  // when the client sent none.
  let rpcRequest = request;
  if (!sentKey) {
    const headers = new Headers(request.headers);
    headers.set("Authorization", `Bearer ${rawKey}`);
    rpcRequest = new Request(request.url, { headers });
  }
  const out = await handleJsonRpc(rpcRequest, body);
  if (out.kind === "notification") {
    return new Response(null, { status: 202 });
  }
  // Push the response back over SSE.
  const outBody = out.kind === "response" ? out.body : out.items;
  try {
    session.send(`event: message\ndata: ${JSON.stringify(outBody)}\n\n`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `sse send failed: ${msg}` }, { status: 500 });
  }
  return new Response(null, { status: 202 });
}
