import { NextResponse } from "next/server";

/**
 * POST /api/mcp/control
 *
 * JSON-RPC 2.0 MCP server for DurinDoor management. Stateless over HTTP.
 * Auth is enforced by the dashboard guard before this handler runs.
 */
import { isObject, isString } from "../../../../shared/utils/typeChecks.js";
export const dynamic = "force-dynamic";

function jsonRpcError(id, code, message) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

export async function POST(request) {
  const body = await request.json().catch(() => null);
  if (!body || !isObject(body)) {
    return jsonRpcError(null, -32700, "Parse error");
  }

  const { id, method } = body;
  const params = body.params ?? {};

  if (body.jsonrpc !== "2.0") {
    return jsonRpcError(id, -32600, "Invalid Request: jsonrpc must be 2.0");
  }
  if (!isString(method)) {
    return jsonRpcError(id, -32600, "Invalid Request: method must be a string");
  }

  // MCP notification: no id field and must return an empty response
  if (method === "notifications/initialized") {
    return new NextResponse(null, { status: 202 });
  }

  if (method === "initialize") {
    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "durindoor-control", version: "1.0.0" }
      }
    });
  }

  if (method === "tools/list") {
    const { listTools } = await import("@/lib/mcp/control/tools");
    return NextResponse.json({ jsonrpc: "2.0", id, result: { tools: listTools() } });
  }

  if (method === "tools/call") {
    if (!isObject(params) || params == null || !isString(params.name)) {
      return jsonRpcError(id, -32602, "Invalid params: tools/call requires name");
    }
    try {
      const { callTool } = await import("@/lib/mcp/control/tools");
      const result = await callTool(params.name, params.arguments ?? {});
      return NextResponse.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } });
    } catch (error) {
      const code = error.status || -32603;
      const message = error.message || "Internal error";
      return jsonRpcError(id, code, message);
    }
  }

  return jsonRpcError(id, -32601, "Method not found");
}