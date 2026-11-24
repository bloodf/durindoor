/** Small JSON HTTP client. Empty or non-JSON responses return null. */
const DEFAULT_HEADERS = { "Content-Type": "application/json" };

async function request(method, url, options = {}, data, jsonParseFallback = null) {
  const init = { ...options, method, headers: { ...DEFAULT_HEADERS, ...options.headers } };
  // Fetch defaults to GET; omit the explicit method for existing read callers.
  if (method === "GET") delete init.method;
  if (data !== undefined) init.body = JSON.stringify(data);
  const response = await fetch(url, init);
  const body = await Promise.resolve().then(() => response.json()).catch(() => jsonParseFallback);
  if (!response.ok) {
    const error = new Error(body?.error || response.statusText);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

/** jsonParseFallback applies to parse failures only. A valid JSON null stays null. */
export const get = (url, { jsonParseFallback = null, ...options } = {}) =>
  request("GET", url, options, undefined, jsonParseFallback);
export const post = (url, data, options = {}) => request("POST", url, options, data);
export const put = (url, data, options = {}) => request("PUT", url, options, data);
export const patch = (url, data, options = {}) => request("PATCH", url, options, data);
export const del = (url, options = {}) => request("DELETE", url, options);

const api = { get, post, put, patch, del };
export default api;
