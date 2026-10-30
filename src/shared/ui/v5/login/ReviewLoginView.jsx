"use client";

import GateScene from "./GateScene.jsx";
import "./login.css";
import { Card } from "@/shared/ui/components/Card.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import { StatusDot } from "@/shared/ui/components/StatusDot.jsx";
import BrandMark from "../../../../../website/src/components/brand/BrandMark.jsx";

export function ReviewLoginView({
  authMode,
  oidcConfigured,
  oidcLoginLabel,
  oidcAvailable,
  passwordAvailable,
  usingDefaultPassword,
  hasPassword,
  mustChange,
  passwordChangeProof,
  error,
  password,
  setPassword,
  newPassword,
  setNewPassword,
  loading,
  retryAfter,
  resetHint,
  handleLogin,
  handleSetNewPassword,
  handleOidcLogin,
  mfaRequired,
  mfaCode,
  setMfaCode,
  handleMfaSubmit,
  onBackToPassword,
  sceneFallback = false,
  scenePaused = false,
}) {
  return (
    <main className="v5-login v5-login-review">
      <section className="v5-login-scene" aria-label="DurinDoor gateway">
        <GateScene fallback={sceneFallback} initiallyPaused={scenePaused} />
        <div className="v5-login-scene-caption"><p>Speak, friend, and enter.</p><span>Your gateway to connected models.</span></div>
      </section>

      <div className="v5-login-form">
        <div className="v5-login-heading">
          <div className="v5-login-brand"><span className="v5-login-brand-mark" role="img" aria-label="DurinDoor logo"><BrandMark size={40} /></span><span>DurinDoor</span></div>
          <h1>{mfaRequired ? "Verify your identity" : mustChange ? "Update your password" : "Welcome back"}</h1>
          <p className="mt-3 text-[13px] text-dd-muted">
            {mfaRequired
              ? "Enter the code from your authenticator app"
              : authMode === "oidc" && oidcConfigured
              ? "Sign in with your OIDC provider to access the dashboard"
              : "Enter your password to access the dashboard"}
          </p>
        </div>
        <Card className="v5-login-fields">
          {mfaRequired ? (
            <form onSubmit={handleMfaSubmit} className="flex flex-col gap-4">
              <Input
                id="mfa-code"
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                label="Authentication code"
                placeholder="000000"
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value)}
                error={error || undefined}
                required
                autoFocus
              />
              <p className="text-xs text-dd-muted">Lost your device? Enter one of your backup codes instead.</p>
              {retryAfter > 0 ? (
                <p aria-live="polite" className="flex items-center gap-2 text-xs text-dd-warning">
                  <StatusDot tone="warning" pulse />
                  Locked. Retry in <span className="font-mono dd-tnum text-dd-text">{retryAfter}s</span>.
                </p>
              ) : null}
              <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={!mfaCode || retryAfter > 0}>
                {retryAfter > 0 ? `Wait ${retryAfter}s` : "Verify"}
              </Button>
              <button type="button" className="text-xs text-dd-muted underline hover:text-dd-text" onClick={onBackToPassword}>
                Back to sign in
              </button>
            </form>
          ) : mustChange && passwordChangeProof ? (
            <form onSubmit={handleSetNewPassword} className="flex flex-col gap-4">
              <Badge tone="warning" size="sm" icon="warning">Password update required</Badge>
              <p className="text-center text-[13px] text-dd-warning">Set a new password before accessing the dashboard remotely.</p>
              <Input
                id="new-password"
                type="password"
                label="New password"
                placeholder="Enter new password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                error={error || undefined}
                required
                autoFocus
              />
              <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={!newPassword}>Set password</Button>
            </form>
          ) : mustChange ? (
            <div className="flex flex-col gap-3 text-center">
              <Badge tone="warning" size="sm" icon="warning" className="mx-auto">Default password</Badge>
              <p className="text-[13px] text-dd-warning">This dashboard is still using the default password. Sign in from the local machine to set a new password before remote access is allowed.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {oidcAvailable ? <Button type="button" variant="primary" className="w-full" onClick={handleOidcLogin}>{oidcLoginLabel}</Button> : null}
              {oidcAvailable && passwordAvailable ? <div className="h-px w-full bg-dd-border-subtle" role="separator" /> : null}
              {passwordAvailable ? (
                <form onSubmit={handleLogin} className="flex flex-col gap-4">
                  {(authMode === "oidc" || authMode === "both") && !oidcConfigured ? (
                    <p className="text-center text-xs text-dd-warning">OIDC login is enabled, but the issuer/client fields are not configured yet. Password login is still available for recovery.</p>
                  ) : null}
                  {authMode === "both" && oidcConfigured ? (
                    <p className="text-center text-xs text-dd-muted">Password and OIDC login are both enabled.</p>
                  ) : null}
                  <Input
                    id="dashboard-password"
                    type="password"
                    label="Password"
                    placeholder="Enter password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    error={error || undefined}
                    required
                    autoFocus={!oidcAvailable}
                  />
                  {retryAfter > 0 ? (
                    <p aria-live="polite" className="flex items-center gap-2 text-xs text-dd-warning">
                      <StatusDot tone="warning" pulse />
                      Locked. Retry in <span className="font-mono dd-tnum text-dd-text">{retryAfter}s</span>.
                    </p>
                  ) : null}
                  {resetHint ? (
                    <p className="text-xs text-dd-muted">Forgot password? Open <code className="rounded bg-dd-surface-2 px-1 text-dd-text">durindoor</code> CLI on the host → <b>Settings</b> → <b>Reset Password to Default</b>.</p>
                  ) : null}
                  <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={retryAfter > 0}>
                    {retryAfter > 0 ? `Wait ${retryAfter}s` : "Login"}
                  </Button>
                  {usingDefaultPassword ? (
                    <p className="mt-2 text-center text-xs text-dd-muted">The configured default password must be changed before remote access is allowed.</p>
                  ) : null}
                  {hasPassword === false ? (
                    <p className="text-center text-xs text-dd-warning">Security risk: no password set. You will be asked to set one when logging in remotely.</p>
                  ) : null}
                </form>
              ) : error ? (
                <p className="text-xs text-dd-danger" role="alert">{error}</p>
              ) : null}
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
