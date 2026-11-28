"use client";

import { requestSettings } from "@/store/settingsStore";

import { useState } from "react";
import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import MfaCard from "./MfaCard.jsx";
import OidcLoginCard from "./OidcLoginCard.jsx";
import { statusClass } from "./profileHelpers.js";

/** Security tab: login requirement, password change, MFA, and OIDC login. */
export default function SecuritySettingsSection({ activeTab, settings, setSettings, loading, confirmPassword, authAvailability }) {
  const [requireLoginError, setRequireLoginError] = useState("");
  const [passwords, setPasswords] = useState({ current: "", new: "", confirm: "" });
  const [passStatus, setPassStatus] = useState({ type: "", message: "" });
  const [passLoading, setPassLoading] = useState(false);

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (passwords.new !== passwords.confirm) {
      setPassStatus({ type: "error", message: "Passwords do not match" });
      return;
    }

    setPassLoading(true);
    setPassStatus({ type: "", message: "" });

    try {
      const res = await requestSettings({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwords.current,
          newPassword: passwords.new
        })
      });

      const data = await res.json();

      if (res.ok && data?.reauthenticate) {
        window.location.assign((process.env.NEXT_PUBLIC_BASE_PATH || "") + "/login");
        return;
      }
      if (res.ok) {
        setPassStatus({ type: "success", message: "Password updated successfully" });
        setPasswords({ current: "", new: "", confirm: "" });
      } else {
        setPassStatus({ type: "error", message: data.error || "Failed to update password" });
      }
    } catch (err) {
      setPassStatus({ type: "error", message: "An error occurred" });
    } finally {
      setPassLoading(false);
    }
  };

  const updateRequireLogin = async (requireLogin) => {
    setRequireLoginError("");
    try {
      const res = await requestSettings({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireLogin }),
        confirmPassword
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, requireLogin }));
      } else {
        setRequireLoginError((await res.json()).error || "Failed to update require login");
      }
    } catch (err) {
      setRequireLoginError("Failed to update require login");
      console.error("Failed to update require login:", err);
    }
  };

  return (
      <section role="tabpanel" aria-label="Security settings" hidden={activeTab !== "security"} className="flex flex-col gap-5">

      <Card padding={false}><CardHeader icon="shield_lock" title="Security" subtitle="Protect access to this dashboard" /><CardContent className="flex flex-col gap-5"><Toggle label="Require login" description="When ON, dashboard requires password. When OFF, access without login." checked={settings.requireLogin === true} onChange={() => updateRequireLogin(!settings.requireLogin)} disabled={loading} />{requireLoginError ? <p role="alert" className="text-xs text-dd-danger">{requireLoginError}</p> : null}{settings.requireLogin === true ? <form onSubmit={handlePasswordChange} className="flex flex-col gap-4 border-t border-dd-border-subtle pt-5"><div className="grid gap-4 md:grid-cols-3"><Input id="profile-current-password" label="Current password" type="password" placeholder="Enter current password" value={passwords.current} onChange={(e) => setPasswords({ ...passwords, current: e.target.value })} required /><Input id="profile-new-password" label="New password" type="password" placeholder="Enter new password" value={passwords.new} onChange={(e) => setPasswords({ ...passwords, new: e.target.value })} required /><Input id="profile-confirm-password" label="Confirm password" type="password" placeholder="Confirm new password" value={passwords.confirm} onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} required /></div>{passStatus.message ? <p role="status" className={`text-xs ${statusClass(passStatus)}`}>{passStatus.message}</p> : null}<div><Button type="submit" variant="primary" loading={passLoading}>{settings.hasPassword ? "Update Password" : "Set Password"}</Button></div></form> : null}</CardContent></Card>

      <MfaCard
        mfaEnabled={settings.mfaEnabled === true}
        mfaBackupCodesRemaining={settings.mfaBackupCodesRemaining || 0}
        onChanged={(patch) => setSettings((current) => ({ ...current, ...patch }))}
      />

      <OidcLoginCard settings={settings} setSettings={setSettings} loading={loading} confirmPassword={confirmPassword} authAvailability={authAvailability} />
      </section>
  );
}
