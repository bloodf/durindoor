"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CallbackStatusView } from "./CallbackStatusView.js";
import { deliverOAuthCallback } from "./callbackDelivery.js";

function CallbackContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("processing");
  const [failureMessage, setFailureMessage] = useState("");

  useEffect(() => deliverOAuthCallback(searchParams, {
    now: Date.now,
    window,
    BroadcastChannel: globalThis.BroadcastChannel,
    getLocalStorage: () => window.localStorage,
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id),
    setStatus,
    setFailureMessage,
    log: console.log,
  }), [searchParams]);

  return <CallbackStatusView status={status} failureMessage={failureMessage} />;
}

export default function CallbackPage() {
  return (
    <Suspense fallback={<CallbackStatusView status="processing" />}>
      <CallbackContent />
    </Suspense>
  );
}
