"use client";

import Image from "next/image";
import { useState, useEffect } from "react";
import { Card, Button, Input } from "@/shared/components";
import { safeNextPath } from "@/lib/auth/safeNextPath";
import { isBrowser } from "@/shared/utils/typeChecks.js";

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

  // Countdown for rate-limit
  useEffect(() => {
    if (retryAfter <= 0) return;
    const id = setInterval(() => setRetryAfter((s) => s > 0 ? s - 1 : 0), 1000);
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
        const res = await fetch(`${baseUrl}/api/auth/status`, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        const data = await res.json();

        if (data.authenticated === true || data.requireLogin === false) {
          window.location.assign(redirectPath);
          return;
        }

        setHasPassword(!!data.hasPassword);
        setUsingDefaultPassword(
          data.usingDefaultPassword === true && (
          data.authMode === "password" || data.authMode === "both")
        );
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
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });

      const data = await res.json().catch(() => ({}));

      // Forced password change responses come back as HTTP 403 with a
      // proof. Parse before any `res.ok` branch so we never silently
      // redirect a default-password client to /dashboard.
      if (data.mustChangePassword) {
        if (data.requiresPasswordChange && data.proof) {
          setPasswordChangeProof(data.proof);
        }
        setMustChange(true);
        return;
      }

      if (res.ok) {
        window.location.assign(nextPath);
        return;
      }

      setError(data.error || "Invalid password");
      if (data.resetHint) setResetHint(data.resetHint);
      if (data.retryAfter) setRetryAfter(Number(data.retryAfter));
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Forced default-password flow receives a one-time local proof rather
  // than dashboard authentication. It can only be spent on this endpoint.
  const handleSetNewPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proof: passwordChangeProof, newPassword })
      });
      const data = await res.json().catch(() => ({}));
      if (data.reauthenticate) {
        setPassword("");
        setNewPassword("");
        setPasswordChangeProof("");
        setMustChange(false);
        setError("Password updated. Please sign in with your new password.");
        return;
      }
      if (res.ok) {
        window.location.assign(nextPath);
        return;
      }
      setError(data.error || "Failed to set password");
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleOidcLogin = () => {
    window.location.href = "/api/auth/oidc/start";
  };

  const oidcAvailable = oidcConfigured && ["oidc", "both"].includes(authMode);
  const passwordAvailable = authMode !== "oidc" || !oidcConfigured;

  // Show loading state while checking password
  if (hasPassword === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-text-muted mt-4">Loading...</p>
        </div>
      </div>);

  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4 relative overflow-hidden">
      {/* Faint grid background */}
      <div className="landing-grid absolute inset-0 pointer-events-none" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <h1>
            {wordmarkFailed ?
            <span>DurinDoor</span> :

            <Image
              src="/durindoor-wordmark.png"
              alt="DurinDoor"
              width={872}
              height={354}
              priority
              onError={() => setWordmarkFailed(true)}
              className="mx-auto h-auto w-72 max-w-full" />

            }
          </h1>
          <p className="text-text-muted">
            {authMode === "oidc" && oidcConfigured ?
            "Sign in with your OIDC provider to access the dashboard" :
            "Enter your password to access the dashboard"}
          </p>
        </div>

        <Card>
          {mustChange && passwordChangeProof ?
          <form onSubmit={handleSetNewPassword} className="flex flex-col gap-4">
              <p className="text-sm text-amber-600 dark:text-amber-400 text-center">
                Set a new password before accessing the dashboard remotely.
              </p>
              <div className="flex flex-col gap-2">
                <label htmlFor="new-password" className="text-sm font-medium">New password</label>
                <Input
                id="new-password"
                type="password"
                placeholder="Enter new password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                aria-describedby={error ? "login-error" : undefined}
                required
                autoFocus />
              
                {error && <p id="login-error" role="alert" aria-live="assertive" className="text-xs text-red-500">{error}</p>}
              </div>
              <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={!newPassword}>
                Set password
              </Button>
            </form> :
          mustChange ?
          <p className="text-sm text-amber-600 dark:text-amber-400 text-center">
              This dashboard is still using the default password. Sign in from
              the local machine to set a new password before remote access is
              allowed.
            </p> :

          <div className="flex flex-col gap-4">
            {oidcAvailable &&
            <Button type="button" variant="primary" className="w-full" onClick={handleOidcLogin}>
                {oidcLoginLabel}
              </Button>
            }

            {oidcAvailable && passwordAvailable && <div className="h-px bg-border/60" />}

            {passwordAvailable ?
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
                {(authMode === "oidc" && !oidcConfigured || authMode === "both" && !oidcConfigured) &&
              <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
                    OIDC login is enabled, but the issuer/client fields are not configured yet. Password login is still available for recovery.
                  </p>
              }

                {authMode === "both" && oidcConfigured &&
              <p className="text-xs text-text-muted text-center">
                    Password and OIDC login are both enabled.
                  </p>
              }

                <div className="flex flex-col gap-2">
                  <label htmlFor="dashboard-password" className="text-sm font-medium">Password</label>
                  <Input
                  id="dashboard-password"
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-describedby={error ? "login-error" : undefined}
                  required
                  autoFocus={!oidcAvailable} />
                
                  {error && <p id="login-error" role="alert" aria-live="assertive" className="text-xs text-red-500">{error}</p>}
                  {retryAfter > 0 &&
                <p aria-live="polite" className="text-xs text-amber-600 dark:text-amber-400">
                      Locked. Retry in <span className="font-mono">{retryAfter}s</span>.
                    </p>
                }
                  {resetHint &&
                <p className="text-xs text-text-muted">
                      Forgot password? Open <code className="bg-sidebar px-1 rounded">durindoor</code> CLI on the host → <b>Settings</b> → <b>Reset Password to Default</b>.
                    </p>
                }
                </div>

                <Button
                type="submit"
                variant="primary"
                className="w-full"
                loading={loading}
                disabled={retryAfter > 0}>
                
                  {retryAfter > 0 ? `Wait ${retryAfter}s` : "Login"}
                </Button>

                {usingDefaultPassword &&
              <p className="text-xs text-center text-text-muted mt-2">
                    The configured default password must be changed before remote access is allowed.
                  </p>
              }
                {hasPassword === false &&
              <p className="text-xs text-center text-amber-600 dark:text-amber-400">
                    Security risk: no password set. You will be asked to set one when logging in remotely.
                  </p>
              }
              </form> :

            error && <p className="text-xs text-red-500">{error}</p>
            }
          </div>
          }
        </Card>
      </div>
    </div>);

}