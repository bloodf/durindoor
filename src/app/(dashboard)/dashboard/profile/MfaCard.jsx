"use client";

import { useState } from "react";
import { Card, CardHeader, CardContent } from "@/shared/ui/components/Card.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";

const STEP_PASSWORD = "password";
const STEP_VERIFY = "verify";
const STEP_BACKUP_CODES = "backup-codes";
const STEP_DISABLE = "disable";

async function readJson(res) {
  return res.json().catch(() => ({}));
}

/**
 * Two-factor authentication card for the dashboard profile page (upstream
 * decolua/9router#4144). Enrollment is a three-step wizard: re-enter the
 * current password, prove the authenticator holds the new secret, then show
 * the one-time backup codes. Nothing is persisted server-side until the
 * verify step succeeds — see /api/auth/mfa/{setup,enable,disable}.
 */
export default function MfaCard({ mfaEnabled, mfaBackupCodesRemaining, onChanged }) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(STEP_PASSWORD);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [secret, setSecret] = useState("");
  const [qrCodeDataUri, setQrCodeDataUri] = useState("");
  const [backupCodes, setBackupCodes] = useState([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  function closeWizard() {
    setWizardOpen(false);
    setStep(STEP_PASSWORD);
    setPassword("");
    setCode("");
    setSecret("");
    setQrCodeDataUri("");
    setBackupCodes([]);
    setError("");
  }

  async function handleBeginSetup(e) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      const res = await fetch("/api/auth/mfa/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setError(data.error || "Failed to start setup");
        return;
      }
      setSecret(data.secret);
      setQrCodeDataUri(data.qrCodeDataUri);
      setStep(STEP_VERIFY);
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function handleVerifyAndEnable(e) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      const res = await fetch("/api/auth/mfa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, secret, code }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setError(data.error || "Invalid code");
        return;
      }
      setBackupCodes(data.backupCodes || []);
      setStep(STEP_BACKUP_CODES);
      onChanged?.({ mfaEnabled: true, mfaBackupCodesRemaining: (data.backupCodes || []).length });
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function handleDisable(e) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      const res = await fetch("/api/auth/mfa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, code }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setError(data.error || "Invalid password or code");
        return;
      }
      onChanged?.({ mfaEnabled: false, mfaBackupCodesRemaining: 0 });
      closeWizard();
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setPending(false);
    }
  }

  function openEnrollWizard() {
    setStep(STEP_PASSWORD);
    setError("");
    setWizardOpen(true);
  }

  function openDisableWizard() {
    setStep(STEP_DISABLE);
    setError("");
    setPassword("");
    setCode("");
    setWizardOpen(true);
  }

  return (
    <Card padding={false}>
      <CardHeader
        icon="shield_person"
        title="Two-factor authentication"
        subtitle="Require a TOTP code in addition to your password"
        actions={
          <Badge tone={mfaEnabled ? "success" : "neutral"} icon={mfaEnabled ? "check_circle" : "radio_button_unchecked"}>
            {mfaEnabled ? "Enabled" : "Disabled"}
          </Badge>
        }
      />
      <CardContent className="flex flex-col gap-4">
        {mfaEnabled ? (
          <>
            <p className="text-[13px] text-dd-muted">
              {mfaBackupCodesRemaining} backup code{mfaBackupCodesRemaining === 1 ? "" : "s"} remaining. Each code works once.
            </p>
            <div>
              <Button variant="danger" onClick={openDisableWizard}>Disable two-factor</Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[13px] text-dd-muted">
              Protect this dashboard with a time-based code from an authenticator app (Google Authenticator, 1Password, Authy).
            </p>
            <div>
              <Button variant="primary" onClick={openEnrollWizard}>Enable two-factor</Button>
            </div>
          </>
        )}
      </CardContent>

      <Modal
        open={wizardOpen}
        onClose={closeWizard}
        title={step === STEP_DISABLE ? "Disable two-factor authentication" : "Enable two-factor authentication"}
        size="sm"
        pending={pending}
      >
        {step === STEP_PASSWORD ? (
          <form onSubmit={handleBeginSetup} className="flex flex-col gap-4">
            <p className="text-[13px] text-dd-muted">Confirm your password to generate a new authenticator secret.</p>
            <Input
              type="password"
              label="Current password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={error || undefined}
              required
              autoFocus
            />
            <Button type="submit" variant="primary" loading={pending} disabled={!password}>Continue</Button>
          </form>
        ) : null}

        {step === STEP_VERIFY ? (
          <form onSubmit={handleVerifyAndEnable} className="flex flex-col gap-4">
            <p className="text-[13px] text-dd-muted">Scan this QR code with your authenticator app, then enter the 6-digit code it shows.</p>
            {qrCodeDataUri ? (
              // eslint-disable-next-line @next/next/no-img-element -- data: URI, not an optimizable remote asset.
              <img src={qrCodeDataUri} alt="Authenticator QR code" className="mx-auto size-48 rounded-dd bg-white p-2" />
            ) : null}
            <div className="rounded-dd bg-dd-surface-2 p-3">
              <p className="text-xs font-medium text-dd-muted">Can&apos;t scan? Enter this key manually</p>
              <code className="block break-all font-mono text-xs text-dd-text">{secret}</code>
            </div>
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              label="6-digit code"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              error={error || undefined}
              required
              autoFocus
            />
            <Button type="submit" variant="primary" loading={pending} disabled={!code}>Verify and enable</Button>
          </form>
        ) : null}

        {step === STEP_BACKUP_CODES ? (
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-dd-warning">
              Save these backup codes now. Each one works once and lets you sign in if you lose your authenticator. They are shown only this one time.
            </p>
            <div className="grid grid-cols-2 gap-2 rounded-dd bg-dd-surface-2 p-3 font-mono text-xs text-dd-text">
              {backupCodes.map((backupCode) => (
                <span key={backupCode}>{backupCode}</span>
              ))}
            </div>
            <Button variant="primary" onClick={closeWizard}>I&apos;ve saved my backup codes</Button>
          </div>
        ) : null}

        {step === STEP_DISABLE ? (
          <form onSubmit={handleDisable} className="flex flex-col gap-4">
            <p className="text-[13px] text-dd-muted">Confirm your password and a current code (TOTP or backup) to turn two-factor off.</p>
            <Input
              type="password"
              label="Current password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
            <Input
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              label="Authentication or backup code"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              error={error || undefined}
              required
            />
            <Button type="submit" variant="danger" loading={pending} disabled={!password || !code}>Disable two-factor</Button>
          </form>
        ) : null}
      </Modal>
    </Card>
  );
}
