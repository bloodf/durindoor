const GLOBAL_KEY = "__kimchi_ua_state";

// Initialize global state if it doesn't exist to persist across Next.js HMR/re-evaluations
if (!globalThis[GLOBAL_KEY]) {
  globalThis[GLOBAL_KEY] = {
    currentAgent: "kimchi/0.1.01", // Default fallback
    lastFetchTime: 0,
    activePromise: null,
    intervalStarted: false,
  };
}

const uaState = globalThis[GLOBAL_KEY];

/**
 * Current Kimchi `User-Agent` (`kimchi/<version>`). Starts at the bundled
 * fallback and is updated in place by {@link updateKimchiUserAgent} after a
 * non-empty release `tag_name` is fetched. Cheap/sync; registry transport
 * headers read through this getter so a version bump propagates.
 * @returns {string} The active Kimchi user-agent string.
 */
export function getKimchiUserAgent() {
  return uaState.currentAgent;
}

/**
 * Refresh the Kimchi `User-Agent` from the latest GitHub release. Parses
 * `tag_name` (stripping a leading `v`); a non-empty value updates the shared
 * `currentAgent` so later {@link getKimchiUserAgent} reads observe it.
 * Browser no-op; in-flight dedup via a shared promise; 1h cache; any error or
 * non-OK response is logged and leaves `currentAgent` unchanged.
 * @param {typeof fetch} [fetcher] Optional fetch implementation.
 * @returns {Promise<string>} The (possibly unchanged) current user-agent.
 */
export async function updateKimchiUserAgent(fetcher) {
  if (typeof window !== "undefined") {
    return uaState.currentAgent;
  }

  // If there's an active fetch in progress, deduplicate by waiting for the same promise
  if (uaState.activePromise) {
    try {
      await uaState.activePromise;
    } catch (_) {}
    return uaState.currentAgent;
  }

  // Prevent fetching more than once per hour to avoid hitting GitHub API rate limits
  const oneHour = 60 * 60 * 1000;
  if (Date.now() - uaState.lastFetchTime < oneHour && uaState.currentAgent !== "kimchi/0.1.01") {
    return uaState.currentAgent;
  }

  // Create the fetch promise
  uaState.activePromise = (async () => {
    try {
      let fetchImpl = fetcher;

      if (!fetchImpl) {
        const path = await import("path");
        const url = await import("url");

        if (typeof process !== "undefined" && typeof process.cwd === "function") {
          const filePath = path.join(process.cwd(), "open-sse", "utils", "proxyFetch.js");
          const fileUrl = url.pathToFileURL(filePath).href;

          // Use new Function to bypass Webpack's compiled import interceptor
          const nativeImport = new Function("specifier", "return import(specifier)");
          const { proxyAwareFetch } = await nativeImport(fileUrl);
          fetchImpl = proxyAwareFetch;
        }
      }

      if (!fetchImpl) {
        return;
      }

      const targetUrl = "https://api.github.com/repos/getkimchi/kimchi/releases/latest";
      console.log("[KimchiUA] Fetching latest release from:", targetUrl);
      const response = await fetchImpl(targetUrl, {
          method: "GET",
          headers: {
            "Accept": "application/vnd.github+json",
            "User-Agent": "9router/1.0.0"
          }
        });

        console.log("[KimchiUA] GitHub response status:", response.status, response.statusText);
        if (response.ok) {
          const data = await response.json();
          const version = data.tag_name ? data.tag_name.replace(/^v/, "") : "";
          console.log("[KimchiUA] Parsed version:", version);
          if (version) {
            uaState.currentAgent = `kimchi/${version}`;
            uaState.lastFetchTime = Date.now();
          }
        } else {
          const errText = await response.text().catch(() => "");
          console.log("[KimchiUA] GitHub error body:", errText.substring(0, 200));
        }
    } catch (error) {
      console.error("[KimchiUA Error]", error);
    }
  })();

  try {
    await uaState.activePromise;
  } finally {
    uaState.activePromise = null;
  }

  return uaState.currentAgent;
}

// Only trigger background fetching on server
if (typeof window === "undefined") {
  if (!uaState.intervalStarted) {
    uaState.intervalStarted = true;
    updateKimchiUserAgent();

    // Periodically update every 4 hours to keep in sync without hitting GitHub API rate limits
    const timer = setInterval(updateKimchiUserAgent, 4 * 60 * 60 * 1000);
    if (timer && typeof timer.unref === "function") {
      timer.unref();
    }
  }
}
