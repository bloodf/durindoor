"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * OAuth Callback Page Content
 */
import { isBrowser } from "../../shared/utils/typeChecks.js";
function CallbackContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("processing");
  const [failureMessage, setFailureMessage] = useState("");

  useEffect(() => {
    const code = searchParams.get("code");
    const token = searchParams.get("token");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");

    // Timestamp the common payload once so every transport can reject a
    // replay from an earlier OAuth attempt, not only the localStorage path.
    const callbackData = {
      code,
      token,
      state,
      error,
      errorDescription,
      timestamp: Date.now()
    };

    // The OAuth code/state is relayed only to the exact dashboard origin.
    // Any other opener is treated as hostile.
    const expectedOrigins = [window.location.origin];
    const timers = [];

    // Method 1: postMessage to opener (popup mode)
    // Send once per expected origin. The browser delivers the message only
    // when the opener's origin matches the targetOrigin we pass — using "*"
    // here would leak the code/state to any opener (e.g. an attacker page
    // that opened this URL in a popup), so iterate over the allowlist.
    if (window.opener) {
      for (const origin of expectedOrigins) {
        try {
          window.opener.postMessage({ type: "oauth_callback", data: callbackData }, origin);
        } catch (e) {
          console.log("postMessage failed:", e);
        }
      }
    }

    // Method 2: BroadcastChannel (same origin tabs)
    try {
      const channel = new BroadcastChannel("oauth_callback");
      channel.postMessage(callbackData);
      channel.close();
    } catch (e) {
      console.log("BroadcastChannel failed:", e);
    }

    // Method 3: localStorage event (fallback)
    try {
      localStorage.setItem("oauth_callback", JSON.stringify(callbackData));
      // The storage event retains the value for other tabs; remove the secret
      // immediately so a later page load cannot recover an OAuth code/token.
      localStorage.removeItem("oauth_callback");
    } catch (e) {
      console.log("localStorage failed:", e);
    }

    if (!(code || token || error)) {
      timers.push(setTimeout(() => setStatus("manual"), 0));
      return () => timers.forEach(clearTimeout);
    }

    if (error) {
      timers.push(setTimeout(() => {
        setFailureMessage(errorDescription || error);
        setStatus("error");
      }, 0));
      return () => timers.forEach(clearTimeout);
    }
    timers.push(setTimeout(() => setStatus("success"), 0));
    timers.push(setTimeout(() => {
      window.close();
      timers.push(setTimeout(() => setStatus("done"), 500));
    }, 1500));
    return () => timers.forEach(clearTimeout);
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="text-center p-8 max-w-md">
        {status === "processing" &&
        <>
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary animate-spin">progress_activity</span>
            </div>
            <h1 className="text-xl font-semibold mb-2">Processing...</h1>
            <p className="text-text-muted">Please wait while we complete the authorization.</p>
          </>
        }

        {(status === "success" || status === "done") &&
        <>
            <div className="size-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-green-600">check_circle</span>
            </div>
            <h1 className="text-xl font-semibold mb-2">Authorization Successful!</h1>
            <p className="text-text-muted">
              {status === "success" ? "This window will close automatically..." : "You can close this tab now."}
            </p>
          </>
        }

        {status === "error" &&
        <>
            <div className="size-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-red-600">error</span>
            </div>
            <h1 className="text-xl font-semibold mb-2">Authorization Failed</h1>
            <p className="text-text-muted">{failureMessage || "The provider rejected this login."}</p>
          </>
        }

        {status === "manual" &&
        <>
            <div className="size-16 mx-auto mb-4 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-yellow-600">info</span>
            </div>
            <h1 className="text-xl font-semibold mb-2">Copy This URL</h1>
            <p className="text-text-muted mb-4">
              Please copy the URL from the address bar and paste it in the application.
            </p>
            <div className="bg-surface border border-border rounded-lg p-3 text-left">
              <code className="text-xs break-all">{isBrowser() ? window.location.href : ""}</code>
            </div>
          </>
        }
      </div>
    </div>);

}

/**
 * OAuth Callback Page
 * Receives callback from OAuth providers and sends data back via multiple methods
 */
export default function CallbackPage() {
  return (
    <Suspense fallback={
    <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="text-center p-8">
          <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
            <span className="material-symbols-outlined text-3xl text-primary animate-spin">progress_activity</span>
          </div>
          <p className="text-text-muted">Loading...</p>
        </div>
      </div>
    }>
      <CallbackContent />
    </Suspense>);

}