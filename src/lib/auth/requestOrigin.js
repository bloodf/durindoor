export function hasExactRequestOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const host = request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).origin === new URL(`${new URL(request.url).protocol}//${host}`).origin;
  } catch {
    return false;
  }
}
