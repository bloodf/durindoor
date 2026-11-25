import { createServer } from "node:http";

/** Start the private plan authorization on the machine running the browser.
 * The account service retains the PKCE verifier and validates the exact callback.
 */
export async function startChatGptPlanLoopback(accounts, { selection, timeoutMs = 600_000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) {
    throw new Error("Invalid authorization timeout");
  }
  let finish;
  let settled = false;
  const result = new Promise((resolve, reject) => { finish = { resolve, reject }; });
  // Callers may cancel before attaching their own handler.
  result.catch(() => {});
  let timer;
  let ready = false;
  const server = createServer(async (request, response) => {
    if (!ready || settled || request.method !== "GET" || !request.url?.startsWith("/auth/callback?")) {
      response.writeHead(404).end();
      return;
    }
    settled = true;
    clearTimeout(timer);
    server.close();
    try {
      const selectionResult = await accounts.finishAuthorization(handle, `${redirectUri}${request.url.slice("/auth/callback".length)}`);
      response.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" }).end("Authorization complete. You may close this window.");
      finish.resolve(selectionResult);
    } catch (error) {
      response.writeHead(400, { "Content-Type": "text/plain", "Cache-Control": "no-store" }).end("Authorization failed. Return to DurinDoor.");
      finish.reject(error);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const redirectUri = `http://127.0.0.1:${server.address().port}/auth/callback`;
  let handle, authorizationUrl;
  try {
    ({ handle, authorizationUrl } = await accounts.beginAuthorization({ redirectUri, selection }));
  } catch (error) {
    server.close();
    throw error;
  }
  ready = true;
  const cancel = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    server.close();
    finish.reject(new Error("Authorization cancelled"));
  };
  timer = setTimeout(cancel, timeoutMs);
  timer.unref();
  return { authorizationUrl, result, cancel };
}
