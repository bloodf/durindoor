import { handleNativeProvider } from "@/sse/handlers/nativeProvider.js";
import { observeHttpRequest } from "open-sse/services/operationalMetrics.js";

export const runtime = "nodejs";

function pathFrom(params) {
  const operation = params?.operation;
  return Array.isArray(operation) && operation.length > 0 ? `/${operation.join("/")}` : null;
}

async function dispatch(request, context) {
  const { provider } = await context.params;
  const path = pathFrom(await context.params);
  if (!path) return new Response(JSON.stringify({ error: { message: "Unknown native operation" } }), { status: 404, headers: { "content-type": "application/json" } });
  return handleNativeProvider(request, provider, path);
}

const observedDispatch = (request, context) => observeHttpRequest(request, () => dispatch(request, context));
export const GET = observedDispatch;
export const POST = observedDispatch;
export const DELETE = observedDispatch;

export async function OPTIONS() {
  return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, x-connection-id" } });
}
