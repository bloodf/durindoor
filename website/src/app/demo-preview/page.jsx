"use client";
import { useEffect, useState } from "react";
import { DashboardLayout } from "@/shared/components";
import EndpointPageClient from "@/app/(dashboard)/dashboard/endpoint/EndpointPageClient";
import DemoBanner from "@site/components/demo/DemoBanner.jsx";
import MockNetwork from "@site/components/demo/MockNetwork.jsx";
import { LOCAL_PORT, MACHINE_ID } from "@site/mock/fixtures/world.js";
import { DEMO_PASSWORD } from "@site/mock/demoPassword.js";

/** Website-only entry: authenticate the browser-local mock before mounting the real UI. */
export default function Preview() {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: DEMO_PASSWORD }),
    })
      .then((response) => {
        if (!response.ok) throw new Error("Demo session unavailable");
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <>
      <MockNetwork />
      {ready ? (
        <>
          <DashboardLayout>
            <EndpointPageClient machineId={MACHINE_ID} localPort={LOCAL_PORT} />
          </DashboardLayout>
          <DemoBanner />
        </>
      ) : (
        <p role="status" style={{ padding: 24 }}>
          {failed
            ? "The sample dashboard could not load. Reload to try again."
            : "Loading the sample dashboard…"}
        </p>
      )}
    </>
  );
}
