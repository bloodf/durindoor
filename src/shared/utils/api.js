/** Small JSON HTTP client. Empty or non-JSON responses return null. */
const DEFAULT_HEADERS = { "Content-Type": "application/json" };

async function request(method, url, requestOptions, data, jsonParseFallback = null, skipErrorBody = false) {
  // Mutation wrappers treat null options as omitted.
  const { strictJson = false, defaultHeaders = true, ...options } = requestOptions ?? {};
  const init = { ...options, method, headers: { ...(defaultHeaders ? DEFAULT_HEADERS : null), ...options.headers } };
  if (!defaultHeaders && !options.headers) delete init.headers;
  // Fetch defaults to GET; omit the explicit method for existing read callers.
  if (method === "GET") delete init.method;
  if (data !== undefined) init.body = JSON.stringify(data);
  // A bare read stays a one-argument fetch.
  const response = Object.keys(init).length ? await fetch(url, init) : await fetch(url);
  let body = null;
  if (response.ok || !skipErrorBody) {
    body = strictJson
      ? (response.status === 204 ? null : await response.json())
      : await Promise.resolve().then(() => response.json()).catch(() => jsonParseFallback);
  }
  if (!response.ok) {
    const error = new Error(body?.error || response.statusText);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

/**
 * jsonParseFallback applies to parse failures only. strictJson propagates parse errors (except 204).
 * skipErrorBody rejects on a non-OK status using statusText and a null error body, without reading it.
 * `defaultHeaders: false` omits the JSON Content-Type, for reads that must send a bare request.
 */
export const get = (url, { jsonParseFallback = null, skipErrorBody = false, ...options } = {}) =>
  request("GET", url, options, undefined, jsonParseFallback, skipErrorBody);
export const post = (url, data, options = {}) => request("POST", url, options, data);
export const put = (url, data, options = {}) => request("PUT", url, options, data);
export const patch = (url, data, options = {}) => request("PATCH", url, options, data);
export const del = (url, options = {}) => request("DELETE", url, options);

const api = { get, post, put, patch, del };
export default api;
