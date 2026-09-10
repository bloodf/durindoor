"use client";

import { Card } from "@/shared/ui/components/Card.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import { StatusDot } from "@/shared/ui/components/StatusDot.jsx";

export function LoginView({
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
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-dd-bg p-4">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,var(--dd-border-subtle)_1px,transparent_1px),linear-gradient(to_bottom,var(--dd-border-subtle)_1px,transparent_1px)] [background-size:48px_48px] opacity-40" />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 text-center">
          {/*
            Token-colored serif wordmark (the legacy /durindoor-wordmark.png is
            white-on-transparent and invisible on the light "Parchment"
            surface). Colors come from dd-* tokens so both themes render.
          */}
          <h1 className="font-serif text-4xl font-semibold tracking-tight text-dd-text">Durin Door</h1>
          <div aria-hidden="true" className="mx-auto mt-2 flex w-40 items-center gap-2">
            <span className="h-px flex-1 bg-dd-accent" />
            <span className="size-2 rotate-45 bg-dd-accent" />
            <span className="h-px flex-1 bg-dd-accent" />
          </div>
          <p className="mt-2 font-serif text-sm italic text-dd-muted">Speak, friend, and enter</p>
          <p className="mt-3 text-[13px] text-dd-muted">
            {authMode === "oidc" && oidcConfigured
              ? "Sign in with your OIDC provider to access the dashboard"
              : "Enter your password to access the dashboard"}
          </p>
        </div>
        <Card className="shadow-dd-elevated">
          {mustChange && passwordChangeProof ? (
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
                <p className="text-xs text-dd-danger">{error}</p>
              ) : null}
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
