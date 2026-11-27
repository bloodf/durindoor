// HTTP response builders shared by API routes.

/**
 * Build the JSON 404 used by the `/v1/*` and `/api/*` catch-all routes.
 *
 * Next.js App Router falls through to `not-found.tsx` for unmatched paths and
 * returns the dashboard HTML shell — OpenAI/Anthropic SDKs crash parsing it.
 * Centralized here so both catch-alls stay byte-identical (#6405 / #6424).
 *
 * @param {Request} request - inbound request (pathname is echoed in the body).
 * @returns {Response} 404 with `error.type === "not_found"`.
 */
export function jsonNotFoundResponse(request) {
  const url = new URL(request.url);
  return Response.json(
    {
      error: {
        message: `Unknown API route: ${url.pathname}`,
        type: "not_found",
        code: "unknown_route",
        path: url.pathname
      }
    },
    { status: 404 }
  );
}

/**
 * Explicit HEAD 200 for routes like `/v1/models` whose GET body is expensive.
 *
 * Next.js 16 auto-derives HEAD from GET and streams the full body; SDK health
 * probes then hang ~6s (#6400). Returning `{ status: 200, body: null }` closes
 * immediately per RFC 9110 §9.3.2.
 *
 * @returns {Response} 200 with a null body.
 */
export function headOkResponse() {
  return new Response(null, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

/**
 * HEAD variant of the catch-all 404: identical status + JSON content-type, but
 * a null body. Returning a JSON body here would clash with the global HEAD
 * body-suppression wrapper (#6608) and violate RFC 9110 §9.3.2 (HEAD carries
 * the headers a GET would, with zero body). Tests assert status + content-type
 * only, so the envelope is intentionally not serialized.
 *
 * @returns {Response} 404 with a null body.
 */
export function headNotFoundResponse() {
  return new Response(null, {
    status: 404,
    headers: {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
