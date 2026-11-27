// The public OAuth routes own verifiers, redirect/client metadata and device
// credentials. Only the server-issued flow handle travels back on completion.
function requireFlow(data) {
  if (typeof data?.flowId !== "string" || !data.flowId.trim()) {
    throw new Error("Missing OAuth flow ID; restart sign-in and update the server if needed");
  }
}

function createCallbackSubmission(provider, data, exchange) {
  requireFlow(data);
  if (typeof data.state !== "string" || !data.state) throw new Error("Missing OAuth state; restart sign-in");
  let submitted = false;
  return async (input) => {
    if (submitted) throw new Error("This callback was already submitted; restart sign-in");
    if (data.expiresAt != null && (!Number.isFinite(data.expiresAt) || Date.now() >= data.expiresAt)) throw new Error("Sign-in expired; restart sign-in");
    let code, state;
    const text = String(input || "").trim();
    // Claude's registered manual-code page returns code#state. Other providers
    // use callback URLs; never interpret a raw access token as an OAuth code.
    if (provider === "claude" && /^[^\s#]+#[^\s#]+$/.test(text)) {
      [code, state] = text.split("#");
    } else {
      let callback;
      try { callback = new URL(text); } catch { throw new Error("Paste the complete callback URL with code and state"); }
      if (!["http:", "https:"].includes(callback.protocol) || callback.username || callback.password) {
        throw new Error("Invalid callback URL");
      }
      const authUrl = new URL(data.authUrl);
      const redirect = data.redirectUri || authUrl.searchParams.get("redirect_uri") || authUrl.searchParams.get("redirect");
      if (!redirect) throw new Error("Missing OAuth redirect context; restart sign-in");
      const expected = new URL(redirect);
      if (callback.origin !== expected.origin || callback.pathname !== expected.pathname) throw new Error("Callback URL does not match this sign-in");
      if (callback.searchParams.getAll("state").length !== 1 || callback.searchParams.getAll("code").length !== 1) {
        throw new Error("Callback must contain one code and matching state");
      }
      if (callback.searchParams.has("error")) throw new Error("Authorization was declined; restart sign-in");
      code = callback.searchParams.get("code");
      state = callback.searchParams.get("state");
    }
    if (!state || state !== data.state) throw new Error("OAuth state is missing or does not match this sign-in");
    if (!code || code.length > 4096 || /\s/.test(code) || /^eyJ[^.]*\.[^.]+\./.test(code)) throw new Error("Invalid authorization code");
    submitted = true; // Set before awaiting transport: duplicate callbacks cannot race.
    try {
      return await exchange(provider, { code, state, flowId: data.flowId });
    } catch {
      return { success: false };
    }
  };
}

function waitForPoll(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

// Let cancellation settle immediately even if a poll is awaiting transport.
// The caller cancels the server flow, whose commit guard rejects late tokens.
async function cancellablePoll(operation, signal) {
  let onAbort;
  const aborted = new Promise((resolve) => {
    onAbort = () => resolve({ cancelled: true });
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } catch {
    return { success: false };
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

async function pollDeviceFlow(provider, data, api, { signal, now = Date.now, wait = waitForPoll } = {}) {
  requireFlow(data);
  const interval = data.interval === undefined ? 5 : Number(data.interval);
  const expiresAt = Number(data.expiresAt);
  if (!Number.isFinite(interval) || interval <= 0 || interval > 3600 || !Number.isFinite(expiresAt) || expiresAt <= now()) {
    throw new Error("Invalid or expired device session; restart sign-in");
  }
  let delay = interval * 1000;
  while (!signal?.aborted && now() < expiresAt) {
    await wait(Math.min(delay, expiresAt - now()), signal);
    if (signal?.aborted || now() >= expiresAt) break;
    const result = await cancellablePoll(api.pollOAuthToken(provider, { flowId: data.flowId }), signal);
    if (signal?.aborted) break;
    if (result.success) return result;
    if (!result.pending && !["authorization_pending", "slow_down"].includes(result.error)) return result;
    if (result.error === "slow_down") delay += 5000;
  }
  await api.cancelOAuthFlow(provider, { flowId: data.flowId });
  return { success: false, cancelled: Boolean(signal?.aborted), error: signal?.aborted ? "cancelled" : "expired_token" };
}

// Only fixed public error categories reach the terminal, never upstream text.
function oauthFailure(result) {
  if (result?.cancelled) return "Sign-in cancelled";
  if (result?.statusCode === 409) return "Sign-in is already being processed; restart if it does not finish";
  if (result?.statusCode === 410 || result?.error === "expired_token") return "Sign-in expired or was already used; restart sign-in";
  if (result?.error === "access_denied") return "Authorization was declined; restart sign-in";
  return "Sign-in failed; restart sign-in and check the local server";
}

module.exports = { createCallbackSubmission, pollDeviceFlow, oauthFailure };
