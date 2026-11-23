/** Return a 403 response for a foreign or absent Origin; otherwise return null. */
export async function requireSameOrigin(request, { allowCliToken, isSameOrigin, message = "Cross-origin request denied" } = {}) {
  const sameOrigin = Boolean(isSameOrigin?.(request));
  if (!request.headers.get("origin") || sameOrigin) return null;
  if (allowCliToken && await allowCliToken(request)) return null;
  return Response.json({ error: message }, { status: 403 });
}
