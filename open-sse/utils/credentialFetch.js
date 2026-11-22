/** Fetch with credentials while keeping every redirect on the original origin. */
export async function credentialFetch(fetcher, input, init = {}, { maxRedirects = 5 } = {}) {
  const origin = new URL(input);
  let url = origin;
  for (let redirects = 0; ; redirects += 1) {
    const response = await fetcher(url.toString(), { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers?.get?.("location");
    if (!location) return response;
    let next;
    try { next = new URL(location, url); } catch { return response; }
    if (next.origin !== origin.origin) {
      const error = new Error("Authentication endpoint redirected to another origin");
      error.name = "CredentialRedirectError";
      error.code = "cross_origin_redirect";
      throw error;
    }
    if (redirects >= maxRedirects) throw new Error("Authentication endpoint exceeded redirect limit");
    url = next;
  }
}
