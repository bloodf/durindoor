import { NextResponse } from "next/server";
import { canAccessLocalOnlyRoute } from "@/dashboardGuard";
import { registerSession, unregisterSession, findPlugin } from "@/lib/mcp/stdioSseBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE handshake for a local stdio MCP plugin bridge.
 *
 * `/api/mcp/` is LOCAL_ONLY in the dashboard guard (loopback + auth, or
 * machine-bound CLI token). Re-check here so a bypassed middleware still
 * cannot register a session or spawn a child. Release the session on both
 * `ReadableStream.cancel()` and `request.signal` abort — cancel alone is
 * not always invoked on client disconnect in Next.js, which would leave
 * the stdio child unreaped.
 */
export async function GET(request, { params }) {
  if (!(await canAccessLocalOnlyRoute(request))) {
    return NextResponse.json({ error: "Local only: CLI token required" }, { status: 403 });
  }

  const { plugin } = await params;
  if (!findPlugin(plugin)) {
    return new Response(`Unknown plugin: ${plugin}`, { status: 404 });
  }

  const encoder = new TextEncoder();
  let sid = null;

  const release = () => {
    if (!sid) return;
    unregisterSession(plugin, sid);
    sid = null;
  };

  const onAbort = () => {
    release();
  };

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk) => {
        try { controller.enqueue(encoder.encode(chunk)); } catch { /* closed */ }
      };
      sid = registerSession(plugin, send);
      // MCP SSE handshake: tell client where to POST messages.
      send(`event: endpoint\ndata: /api/mcp/${plugin}/message?sessionId=${sid}\n\n`);
    },
    cancel() {
      // Normal completion/disconnect: unregister exactly once, then detach
      // the abort listener. abort and cancel can both fire; release() is
      // idempotent so the bridge's "last session leaves" kill runs once.
      release();
      request.signal.removeEventListener("abort", onAbort);
    },
  });

  // Client disconnect: cancel() is not always invoked in Next.js; wire
  // request.signal the same way /api/mcp-gateway/sse does. If the signal is
  // already aborted, the listener runs on the next tick after start() registered.
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
