"use client";
import Link from "next/link";
import { RefreshCw, BookOpen, LayoutDashboard } from "lucide-react";
import { useEffect, useState } from "react";
import "./preview.css";
import { DashboardLayout } from "@/shared/components";
import EndpointPageClient from "@/app/(dashboard)/dashboard/endpoint/EndpointPageClient";
import DemoBanner from "@site/components/demo/DemoBanner.jsx";
import MockNetwork from "@site/components/demo/MockNetwork.jsx";
import { LOCAL_PORT, MACHINE_ID } from "@site/mock/fixtures/world.js";
import { DEMO_PASSWORD } from "@site/mock/demoPassword.js";

/** Website-only entry: authenticate the browser-local mock before mounting the real UI. */
export default function Preview() {
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
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
  }, [attempt]);
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
        <section className="demo-entry-state" aria-labelledby="demo-entry-title">
          <LayoutDashboard size={28} aria-hidden="true" />
          <h1 id="demo-entry-title">{failed ? "The sample dashboard could not load" : "Loading the sample dashboard"}</h1>
          <p role={failed ? "alert" : "status"}>{failed ? "Your sample data is still in this browser. Try loading it again." : "Preparing browser-local sample data. No provider account is needed."}</p>
          {failed && <div className="demo-entry-actions">
            <button type="button" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={16} aria-hidden="true" />Try again</button>
            <Link href="/docs"><BookOpen size={16} aria-hidden="true" />Read the docs</Link>
          </div>}
        </section>
      )}
    </>
  );
}
