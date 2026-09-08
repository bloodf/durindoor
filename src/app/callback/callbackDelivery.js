export function deliverOAuthCallback(searchParams, runtime) {
  const code = searchParams.get("code");
  const token = searchParams.get("token");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  const callbackData = { code, token, state, error, errorDescription, timestamp: runtime.now() };
  const expectedOrigins = [runtime.window.location.origin];
  const timers = new Set();
  let disposed = false;
  const schedule = (callback, delay) => {
    const id = runtime.setTimeout(() => {
      timers.delete(id);
      if (!disposed) callback();
    }, delay);
    timers.add(id);
    return id;
  };

  if (runtime.window.opener) {
    for (const origin of expectedOrigins) {
      try {
        runtime.window.opener.postMessage({ type: "oauth_callback", data: callbackData }, origin);
      } catch (e) {
        runtime.log("postMessage failed:", e);
      }
    }
  }

  try {
    const channel = new runtime.BroadcastChannel("oauth_callback");
    channel.postMessage(callbackData);
    channel.close();
  } catch (e) {
    runtime.log("BroadcastChannel failed:", e);
  }

  try {
    const localStorage = runtime.getLocalStorage();
    localStorage.setItem("oauth_callback", JSON.stringify(callbackData));
    localStorage.removeItem("oauth_callback");
  } catch (e) {
    runtime.log("localStorage failed:", e);
  }

  if (!(code || token || error)) {
    schedule(() => runtime.setStatus("manual"), 0);
  } else if (error) {
    schedule(() => {
      runtime.setFailureMessage(errorDescription || error);
      runtime.setStatus("error");
    }, 0);
  } else {
    schedule(() => runtime.setStatus("success"), 0);
    schedule(() => {
      runtime.window.close();
      schedule(() => runtime.setStatus("done"), 500);
    }, 1500);
  }

  return () => {
    disposed = true;
    for (const id of timers) runtime.clearTimeout(id);
    timers.clear();
  };
}
