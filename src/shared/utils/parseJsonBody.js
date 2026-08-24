import { NextResponse } from "next/server";

/**
 * Shared JSON request-body boundary for mutating API routes: returns a 400
 * `{ error: "Invalid JSON body" }` when the body is unparseable or not an
 * object, instead of letting it fall into the route's broad try/catch as a 500.
 * Call OUTSIDE the handler `try` so downstream failures keep their own status.
 * @param {Request} request
 * @returns {Promise<{ok: true, body: object} | {ok: false, response: Response}>}
 */
import { isObject } from "./typeChecks.js";
export async function parseJsonBody(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) };
  }
  if (body === null || !isObject(body) || Array.isArray(body)) {
    return { ok: false, response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) };
  }
  return { ok: true, body };
}