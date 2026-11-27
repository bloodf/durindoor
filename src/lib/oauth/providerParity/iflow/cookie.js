import { isString } from "../../../../shared/utils/typeChecks.js";

/**
 * Prepare an iFlow cookie import using the existing platform key endpoints.
 * The caller owns authentication, connection storage and response sanitization.
 * No retries are made: the POST may have rotated the key even if its reply is lost.
 */
export async function importIflowCookie(cookie, { fetch: transport = globalThis.fetch, signal } = {}) {
  if (!isString(cookie) || /[\r\n]/.test(cookie)) throw new Error("Invalid iFlow cookie");
  const matches = [...cookie.matchAll(/(?:^|;)\s*BXAuth=([^;\s]+)\s*(?=;|$)/g)];
  if (matches.length !== 1) throw new Error("A single BXAuth cookie is required");
  const session = `BXAuth=${matches[0][1]};`;
  const url = "https://platform.iflow.cn/api/openapi/apikey";
  const headers = {
    Cookie: session,
    Accept: "application/json, text/plain, */*",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
  };
  async function read(response) {
    if (!response.ok) throw new Error("iFlow cookie verification failed");
    let result;
    try { result = await response.json(); } catch { throw new Error("iFlow cookie verification failed"); }
    if (!result?.success || !result.data) throw new Error("iFlow cookie verification failed");
    return result.data;
  }
  async function send(options) {
    try { return await transport(url, options); } catch {
      if (signal?.aborted) throw new Error("iFlow cookie import aborted");
      throw new Error("iFlow cookie verification failed");
    }
  }
  const current = await read(await send({ method: "GET", headers: { ...headers, "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-origin" }, signal }));
  if (!isString(current.name) || !current.name.trim()) throw new Error("iFlow profile is incomplete");
  const refreshed = await read(await send({
    method: "POST", signal,
    headers: { ...headers, "Content-Type": "application/json", Origin: "https://platform.iflow.cn", Referer: "https://platform.iflow.cn/" },
    body: JSON.stringify({ name: current.name }),
  }));
  if (!isString(refreshed.apiKey) || !refreshed.apiKey.trim()) throw new Error("iFlow API key is missing");
  return {
    provider: "iflow", authType: "cookie", name: refreshed.name || current.name,
    email: refreshed.name || current.name, apiKey: refreshed.apiKey,
    providerSpecificData: { cookie: session, expireTime: refreshed.expireTime },
    testStatus: "active", isActive: true,
  };
}
