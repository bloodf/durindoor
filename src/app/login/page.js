"use client";

import { useState, useEffect } from "react";
import { safeNextPath } from "@/lib/auth/safeNextPath";
import { isBrowser } from "../../shared/utils/typeChecks.js";
import { LoginView } from "./LoginView.js";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [resetHint, setResetHint] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasPassword, setHasPassword] = useState(null);
  const [usingDefaultPassword, setUsingDefaultPassword] = useState(false);
  const [authMode, setAuthMode] = useState("password");
  const [oidcConfigured, setOidcConfigured] = useState(false);
  const [oidcLoginLabel, setOidcLoginLabel] = useState("Sign in with OIDC");
  const [mustChange, setMustChange] = useState(false);
  const [passwordChangeProof, setPasswordChangeProof] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [wordmarkFailed, setWordmarkFailed] = useState(false);
  const [nextPath, setNextPath] = useState("/dashboard");

  useEffect(() => {
    if (retryAfter <= 0) return undefined;
    const id = setInterval(() => setRetryAfter((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [retryAfter]);

  useEffect(() => {
    setNextPath(safeNextPath(new URLSearchParams(window.location.search).get("next")));
  }, []);

  useEffect(() => {
    async function checkAuth() {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const baseUrl = isBrowser() ? window.location.origin : "";
      const redirectPath = safeNextPath(new URLSearchParams(window.location.search).get("next"));
      try {
        const res = await fetch(`${baseUrl}/api/auth/status`, { signal: controller.signal });
        clearTimeout(timeoutId);
        const data = await res.json();
        if (data.authenticated === true || data.requireLogin === false) {
          window.location.assign(redirectPath);
          return;
        }
        setHasPassword(!!data.hasPassword);
        setUsingDefaultPassword(data.usingDefaultPassword === true && (data.authMode === "password" || data.authMode === "both"));
        setAuthMode(data.authMode || "password");
        setOidcConfigured(data.oidcConfigured === true);
        setOidcLoginLabel(data.oidcLoginLabel || "Sign in with OIDC");
      } catch (err) {
        clearTimeout(timeoutId);
        setHasPassword(true);
      }
    }
    checkAuth();
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResetHint("");
    setMustChange(false);
    setPasswordChangeProof("");
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const data = await res.json().catch(() => ({}));
      if (data.mustChangePassword) {
        if (data.requiresPasswordChange && data.proof) setPasswordChangeProof(data.proof);
        setMustChange(true);
        return;
      }
      if (res.ok) { window.location.assign(nextPath); return; }
      setError(data.error || "Invalid password");
      if (data.resetHint) setResetHint(data.resetHint);
      if (data.retryAfter) setRetryAfter(Number(data.retryAfter));
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSetNewPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/change-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proof: passwordChangeProof, newPassword }) });
      const data = await res.json().catch(() => ({}));
      if (data.reauthenticate) {
        setPassword(""); setNewPassword(""); setPasswordChangeProof(""); setMustChange(false);
        setError("Password updated. Please sign in with your new password.");
        return;
      }
      if (res.ok) { window.location.assign(nextPath); return; }
      setError(data.error || "Failed to set password");
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleOidcLogin = () => { window.location.href = "/api/auth/oidc/start"; };

  const oidcAvailable = oidcConfigured && ["oidc", "both"].includes(authMode);
  const passwordAvailable = authMode !== "oidc" || !oidcConfigured;

  if (hasPassword === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-dd-bg p-4" role="status" aria-live="polite">
        <div className="text-center">
          <span aria-hidden="true" className="material-symbols-outlined mx-auto block animate-spin text-[32px] text-dd-accent">progress_activity</span>
          <p className="mt-4 text-[13px] text-dd-muted">Loading…</p>
        </div>
      </main>
    );
  }

  return (
    <LoginView
      wordmarkFailed={wordmarkFailed}
      setWordmarkFailed={setWordmarkFailed}
      authMode={authMode}
      oidcConfigured={oidcConfigured}
      oidcLoginLabel={oidcLoginLabel}
      oidcAvailable={oidcAvailable}
      passwordAvailable={passwordAvailable}
      usingDefaultPassword={usingDefaultPassword}
      hasPassword={hasPassword}
      mustChange={mustChange}
      passwordChangeProof={passwordChangeProof}
      error={error}
      password={password}
      setPassword={setPassword}
      newPassword={newPassword}
      setNewPassword={setNewPassword}
      loading={loading}
      retryAfter={retryAfter}
      resetHint={resetHint}
      handleLogin={handleLogin}
      handleSetNewPassword={handleSetNewPassword}
      handleOidcLogin={handleOidcLogin}
    />
  );
}
