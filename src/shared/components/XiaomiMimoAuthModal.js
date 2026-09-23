"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/ui/components/Modal.jsx";
import Button from "@/shared/ui/components/Button.jsx";

/**
 * Xiaomi MiMo account auth modal (the "OAuth" entry of the dual-auth provider).
 *
 * Two ways to link a Xiaomi account, whose weekly Desktop quota then serves the
 * v2.6 models on the account-service route:
 *   1. Import local MiMo Desktop credentials (~/.local/share/mimocode/auth.json
 *      plus Desktop's cookie store), via /api/oauth/xiaomi-mimo/auto-import.
 *   2. Browser login, no Desktop needed: pick a cluster, sign in on the real
 *      Xiaomi page served through the DurinDoor login proxy, and the captured
 *      passToken is stored on a session-only connection.
 *
 * The cloud sk- API key keeps using the standard "Add API Key" entry.
 */

const CLUSTERS = [
  { id: "cn", name: "China (Mainland)", host: "mimo-server-cn" },
  { id: "sgp", name: "Singapore", host: "mimo-server-sgp" },
  { id: "ams", name: "Europe · Amsterdam", host: "mimo-server-ams" },
  { id: "ru", name: "Russia", host: "mimo-server-ru" },
  { id: "in", name: "India", host: "mimo-server-in" },
];
const POLL_MS = 2500;
const LOGIN_TIMEOUT_MS = 14 * 60 * 1000;
const POPUP = ["mimo-session-login", "width=500,height=760"];

async function postCredentials(payload) {
  const res = await fetch("/api/oauth/xiaomi-mimo/api-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || "Failed to save credentials");
  return data.connection;
}

export default function XiaomiMimoAuthModal({ isOpen, onSuccess, onClose }) {
  const [phase, setPhase] = useState("detecting"); // detecting | found | not-found | importing
  const [detected, setDetected] = useState(null);
  const [error, setError] = useState(null);
  const [pickCluster, setPickCluster] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginPageUrl, setLoginPageUrl] = useState(null);
  const [loginError, setLoginError] = useState(null);
  const pollRef = useRef(null);

  const stopPoll = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setLoginPageUrl(null);
  };

  useEffect(() => () => stopPoll(), []);

  // Detect local Desktop credentials on open; clear everything on close so a
  // key never lingers in component state.
  useEffect(() => {
    if (!isOpen) {
      stopPoll();
      setDetected(null);
      setError(null);
      setLoginError(null);
      setPickCluster(false);
      return;
    }
    let cancelled = false;
    setPhase("detecting");
    fetch("/api/oauth/xiaomi-mimo/auto-import", { signal: AbortSignal.timeout(5000) })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.found && data.apiKey) {
          setDetected(data);
          setPhase("found");
        } else {
          setPhase("not-found");
        }
      })
      .catch(() => !cancelled && setPhase("not-found"));
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const finish = (connection) => {
    onSuccess?.(connection);
    onClose();
  };

  const importLocal = async () => {
    setPhase("importing");
    setError(null);
    try {
      finish(await postCredentials({
        apiKey: detected.apiKey,
        uid: detected.uid,
        baseUrl: detected.baseUrl,
        mimoPassToken: detected.mimoPassToken || null,
        mimoUserId: detected.mimoUserId || null,
        mimoCUserId: detected.mimoCUserId || null,
      }));
    } catch (err) {
      setPhase("found");
      setError(err.message);
    }
  };

  const pollLogin = (state, region, startedAt) => async () => {
    if (Date.now() - startedAt > LOGIN_TIMEOUT_MS) {
      stopPoll();
      setLoginError("Login timed out. Please retry.");
      return;
    }
    try {
      const res = await fetch(`/api/oauth/xiaomi-mimo/login/status?state=${encodeURIComponent(state)}`);
      const status = await res.json();
      if (status.status === "pending") return;
      stopPoll();
      if (status.status !== "done") throw new Error(status.error || "Login session expired — please retry.");
      finish(await postCredentials({
        uid: status.userId || null,
        mimoPassToken: status.passToken,
        mimoUserId: status.userId || null,
        mimoCUserId: status.cUserId || null,
        region: status.region || region,
      }));
    } catch (err) {
      stopPoll();
      setLoginError(err.message);
    }
  };

  const startLogin = async (region) => {
    setPickCluster(false);
    setLoginBusy(true);
    setLoginError(null);
    try {
      const res = await fetch("/api/oauth/xiaomi-mimo/login/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region }),
      });
      const data = await res.json();
      if (!res.ok || !data.pageUrl) throw new Error(data.error || "Failed to start login");
      setLoginPageUrl(data.pageUrl);
      window.open(data.pageUrl, ...POPUP);
      pollRef.current = setInterval(pollLogin(data.state, region, Date.now()), POLL_MS);
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setLoginBusy(false);
    }
  };

  const browserLogin = (
    <section className="flex flex-col gap-3 rounded-dd border border-dd-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-dd-text">
          <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none text-dd-accent">login</span>
          Browser Login
        </p>
        <span className="text-xs text-dd-muted">No Desktop required</span>
      </div>
      {loginPageUrl ? (
        <div className="flex flex-col gap-2">
          <p role="status" aria-live="polite" className="text-xs text-dd-muted">Waiting for login...</p>
          <Button variant="ghost" size="sm" onClick={() => window.open(loginPageUrl, ...POPUP)}>Reopen login window</Button>
        </div>
      ) : pickCluster ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs text-dd-muted">Choose the region cluster of your Xiaomi account:</legend>
          {CLUSTERS.map((c) => (
            <Button key={c.id} variant="secondary" onClick={() => startLogin(c.id)} className="justify-between">
              <span>{c.name}</span>
              <span className="font-mono text-xs text-dd-muted">{c.host}</span>
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setPickCluster(false)}>Cancel</Button>
        </fieldset>
      ) : (
        <Button variant="secondary" loading={loginBusy} onClick={() => setPickCluster(true)}>Choose cluster & sign in</Button>
      )}
      {loginError ? <p role="alert" className="text-xs text-dd-danger">{loginError}</p> : null}
    </section>
  );

  const busy = phase === "detecting" || phase === "importing";

  return (
    <Modal
      open={isOpen}
      title="Connect Xiaomi MiMo"
      subtitle="Link a Xiaomi account to use its weekly MiMo quota."
      onClose={onClose}
      pending={phase === "importing"}
      closeOnEscape={phase !== "importing"}
      closeOnOverlay={phase !== "importing"}
    >
      <div className="flex flex-col gap-4">
        {busy ? (
          <div role="status" aria-live="polite" className="py-8 text-center">
            <span aria-hidden="true" className="material-symbols-outlined animate-spin text-[32px] leading-none text-dd-accent">progress_activity</span>
            <p className="mt-3 text-sm text-dd-muted">{phase === "importing" ? "Connecting..." : "Reading local MiMo Desktop credentials..."}</p>
          </div>
        ) : (
          <>
            {phase === "found" && detected ? (
              <section className="flex flex-col gap-3">
                <div className="flex gap-2 rounded-dd border border-dd-success/30 bg-dd-success/10 p-3 text-[13px] text-dd-success">
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">check_circle</span>
                  <div>
                    <p className="font-medium">Xiaomi MiMo Desktop credentials found!</p>
                    <p className="mt-0.5 text-xs opacity-80">UID: {detected.uid || "—"}</p>
                  </div>
                </div>
                {error ? <p role="alert" className="rounded-dd border border-dd-danger/30 bg-dd-danger/10 p-3 text-[13px] text-dd-danger">{error}</p> : null}
                <Button variant="primary" onClick={importLocal}>Connect with local credentials</Button>
              </section>
            ) : (
              <div className="flex gap-2 rounded-dd border border-dd-info/30 bg-dd-info/10 p-3 text-[13px] text-dd-info">
                <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">info</span>
                <div>
                  <p className="font-medium">No local Desktop credentials found</p>
                  <p className="mt-0.5 text-xs opacity-80">You can still sign in via browser — no Desktop client needed.</p>
                </div>
              </div>
            )}
            {browserLogin}
            <div className="flex justify-end">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

XiaomiMimoAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
