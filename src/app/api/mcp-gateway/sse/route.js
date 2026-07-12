// SSE handshake endpoint for the MCP gateway.
//
// Like the existing /api/mcp/[plugin]/sse, but:
//   - the endpoint URL posted to the client is /api/mcp-gateway/message?sessionId=<sid>
//   - sessions are isolated per gateway call, not per preset stdio plugin
//   - the actual upstream fan-out lives in the message route

import { registerSession, unregisterSession } from "@/lib/mcp/gateway/sseSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const encoder = new TextEncoder();
  let sid = null;
  const onAbort = () => {
    if (sid) {
      unregisterSession(sid);
      sid = null;
    }
  };
  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk) => {
        try { controller.enqueue(encoder.encode(chunk)); } catch { /* closed */ }
      };
      sid = registerSession(send);
      send(`event: endpoint\ndata: /api/mcp-gateway/message?sessionId=${sid}\n\n`);
    },
    cancel() {
      // Normal completion/disconnect: unregister exactly once, then detach
      // the abort listener. Without the detach every completed connection
      // leaks the listener + its sid closure until the signal is GC'd, and a
      // later abort would double-unregister. sid = null makes any path that
      // still fires after this a no-op.
      if (sid) {
        unregisterSession(sid);
        sid = null;
      }
      request.signal.removeEventListener("abort", onAbort);
    },
  });
  // Client disconnect: cancel() fires, but if the request aborts without the
  // stream being consumed/cancelled the session would linger until the TTL
  // sweep — unregister eagerly on abort. `once` self-removes the listener
  // after it fires; cancel() removes it on the normal path.
  request.signal.addEventListener("abort", onAbort, { once: true });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
