import api from "@/shared/utils/api";

// Preserve the existing response-based handlers while the shared client owns HTTP errors.
export async function dashboardRequest(url, options = {}) {
  const { method = "GET", ...requestOptions } = options;
  const optionsWithoutDefaultHeaders = { ...requestOptions, defaultHeaders: false };
  try {
    let body;
    switch (method) {
      case "GET": body = await api.get(url, optionsWithoutDefaultHeaders); break;
      case "POST": body = await api.post(url, undefined, optionsWithoutDefaultHeaders); break;
      case "PUT": body = await api.put(url, undefined, optionsWithoutDefaultHeaders); break;
      case "PATCH": body = await api.patch(url, undefined, optionsWithoutDefaultHeaders); break;
      case "DELETE": body = await api.del(url, optionsWithoutDefaultHeaders); break;
      default: throw new Error(`Unsupported method: ${method}`);
    }
    return { ok: true, json: async () => body };
  } catch (error) {
    if (!Object.hasOwn(error, "body")) throw error;
    return { ok: false, status: error.status, json: async () => error.body ?? {} };
  }
}
