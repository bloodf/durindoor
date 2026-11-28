"use client";

import { requestSettings } from "@/store/settingsStore";

import { useState, useEffect } from "react";
import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import Field from "@/shared/ui/components/Field.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import SegmentedControl from "@/shared/ui/components/SegmentedControl.jsx";
import Textarea from "@/shared/ui/components/Textarea.jsx";
import { isBrowser } from "../../../../shared/utils/typeChecks.js";
import api from "@/shared/utils/api";
import { AUTH_OPTIONS as authOptions, oidcAllowlistDraft, splitOidcAllowlist, statusClass } from "./profileHelpers.js";

/** Draft OIDC form seeded from the saved settings snapshot. */
function oidcFormFromSettings(data) {
  return {
    authMode: data?.authMode === "sso" ? "oidc" : data?.authMode || "password",
    oidcIssuerUrl: data?.oidcIssuerUrl || "",
    oidcClientId: data?.oidcClientId || "",
    oidcScopes: data?.oidcScopes || "openid profile email",
    oidcLoginLabel: data?.oidcLoginLabel || "Sign in with OIDC",
    ...oidcAllowlistDraft(data)
  };
}

/**
 * OIDC dashboard login card. Mounts only after saved settings load, so the
 * draft and the expanded state start from that snapshot.
 */
export default function OidcLoginCard({ settings, setSettings, loading, confirmPassword, authAvailability }) {
  const [oidcForm, setOidcForm] = useState(() => oidcFormFromSettings(settings));
  const [oidcClientSecret, setOidcClientSecret] = useState("");
  const [oidcStatus, setOidcStatus] = useState({ type: "", message: "" });
  const [oidcLoading, setOidcLoading] = useState(false);
  const [oidcTestLoading, setOidcTestLoading] = useState(false);
  const [oidcTestStatus, setOidcTestStatus] = useState({ type: "", message: "" });
  const [oidcRedirectUri, setOidcRedirectUri] = useState("/api/auth/oidc/callback");
  const [oidcExpanded, setOidcExpanded] = useState(() => ["sso", "oidc", "both"].includes(settings?.authMode));

  useEffect(() => {
    if (isBrowser()) {
      setOidcRedirectUri(`${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/auth/oidc/callback`);
    }
  }, []);

  const updateOidcForm = (field, value) => {
    setOidcForm((prev) => ({ ...prev, [field]: value }));
  };

  const saveOidcSettings = async (authMode = oidcForm.authMode || "password") => {
    const issuerUrl = oidcForm.oidcIssuerUrl.trim();
    const clientId = oidcForm.oidcClientId.trim();
    const scopes = oidcForm.oidcScopes.trim();
    const loginLabel = oidcForm.oidcLoginLabel.trim();
    const secret = oidcClientSecret.trim();

    if (authMode !== "password" && (!issuerUrl || !clientId || !secret) && !settings.oidcConfigured) {
      setOidcStatus({ type: "error", message: "Issuer URL, client ID, and client secret are required to enable OIDC." });
      return;
    }

    setOidcLoading(true);
    setOidcStatus({ type: "", message: "" });
    setOidcTestStatus({ type: "", message: "" });

    try {
      const payload = {
        authMode,
        oidcIssuerUrl: issuerUrl,
        oidcClientId: clientId,
        oidcScopes: scopes || "openid profile email",
        oidcLoginLabel: loginLabel || "Sign in with OIDC",
        oidcAllowedSubjects: splitOidcAllowlist(oidcForm.oidcAllowedSubjects),
        oidcAllowedEmails: splitOidcAllowlist(oidcForm.oidcAllowedEmails),
        oidcAllowedDomains: splitOidcAllowlist(oidcForm.oidcAllowedDomains)
      };
      if (secret) {
        payload.oidcClientSecret = secret;
      }

      const res = await requestSettings({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        confirmPassword
      });

      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...data }));
        setOidcForm({
          authMode: data?.authMode || authMode,
          oidcIssuerUrl: data?.oidcIssuerUrl || issuerUrl,
          oidcClientId: data?.oidcClientId || clientId,
          oidcScopes: data?.oidcScopes || scopes || "openid profile email",
          oidcLoginLabel: data?.oidcLoginLabel || loginLabel || "Sign in with OIDC",
          ...oidcAllowlistDraft(data)
        });
        setOidcClientSecret("");
        setOidcStatus({
          type: "success",
          message:
          authMode === "oidc" ?
          "OIDC login enabled" :
          authMode === "both" ?
          "Password and OIDC login enabled" :
          "OIDC settings saved"
        });
      } else {
        setOidcStatus({ type: "error", message: data.error || "Failed to save OIDC settings" });
      }
    } catch (err) {
      setOidcStatus({ type: "error", message: "An error occurred" });
    } finally {
      setOidcLoading(false);
    }
  };

  const testOidcConnection = async () => {
    const issuerUrl = oidcForm.oidcIssuerUrl.trim();
    const clientId = oidcForm.oidcClientId.trim();
    const scopes = oidcForm.oidcScopes.trim();
    const secret = oidcClientSecret.trim();

    if (!issuerUrl || !clientId) {
      setOidcTestStatus({ type: "error", message: "Issuer URL and client ID are required to test the connection." });
      return;
    }

    setOidcTestLoading(true);
    setOidcStatus({ type: "", message: "" });
    setOidcTestStatus({ type: "", message: "" });

    try {
      const saveRes = await requestSettings({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authMode: oidcForm.authMode || settings.authMode || "password",
          oidcIssuerUrl: issuerUrl,
          oidcClientId: clientId,
          oidcScopes: scopes || "openid profile email",
          oidcLoginLabel: oidcForm.oidcLoginLabel.trim() || "Sign in with OIDC",
          ...(secret ? { oidcClientSecret: secret } : null)
        }),
        confirmPassword
      });

      const saved = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) {
        setOidcTestStatus({
          type: "error",
          message: saved.error || "Failed to save OIDC settings before testing"
        });
        return;
      }

      const data = await api.post("/api/auth/oidc/test", {
        issuerUrl: saved.oidcIssuerUrl || issuerUrl,
        clientId: saved.oidcClientId || clientId,
        scopes: saved.oidcScopes || scopes || "openid profile email"
      });

      if (data?.ok) {
        const statusMessage = data.clientSecretTested ?
        data.clientSecretValid === true ?
        `Connection OK. Discovery loaded from ${data.issuerUrl}. Client secret validated too.` :
        `Connection OK. Discovery loaded from ${data.issuerUrl}. Client secret was not checked.` :
        `Connection OK. Discovery loaded from ${data.issuerUrl}.`;
        setOidcTestStatus({
          type: "success",
          message: statusMessage
        });
      } else {
        setOidcTestStatus({ type: "error", message: data?.error || "OIDC connection test failed" });
      }
    } catch (err) {
      setOidcTestStatus({
        type: "error",
        message: err?.status !== undefined ? (err.body?.error || "OIDC connection test failed") : "An error occurred"
      });
    } finally {
      setOidcTestLoading(false);
    }
  };

  return (
      <Card padding={false}><CardHeader icon="badge" title="OIDC Dashboard Login" subtitle={authAvailability.oidcAvailable && !authAvailability.passwordAvailable ? "OIDC active" : authAvailability.oidcAvailable && authAvailability.passwordAvailable ? "Password + OIDC active" : "Optional SSO via Authentik, Keycloak, or Google"} actions={<Button variant="ghost" icon={oidcExpanded ? "expand_less" : "expand_more"} aria-label="Toggle OIDC settings" aria-expanded={oidcExpanded} disabled={loading} onClick={() => setOidcExpanded((v) => !v)} />} />{oidcExpanded ? <CardContent className="flex flex-col gap-5"><Field group label="Auth mode" hint="Choose password login, OIDC, or both."><SegmentedControl aria-label="Auth mode" options={authOptions} value={oidcForm.authMode} onChange={(value) => updateOidcForm("authMode", value)} disabled={loading || oidcLoading} /></Field><div className="grid gap-4 md:grid-cols-2"><Input label="Issuer URL" placeholder="https://auth.example.com/application/o/durindoor/" value={oidcForm.oidcIssuerUrl} onChange={(e) => updateOidcForm("oidcIssuerUrl", e.target.value)} disabled={loading || oidcLoading} /><Input label="Client ID" placeholder="durindoor-dashboard" value={oidcForm.oidcClientId} onChange={(e) => updateOidcForm("oidcClientId", e.target.value)} disabled={loading || oidcLoading} /><Input label="Client Secret" hint="This value is write-only after saving." type="password" placeholder="Leave blank to keep existing secret" value={oidcClientSecret} onChange={(e) => setOidcClientSecret(e.target.value)} disabled={loading || oidcLoading} /><Input label="Scopes" placeholder="openid profile email" value={oidcForm.oidcScopes} onChange={(e) => updateOidcForm("oidcScopes", e.target.value)} disabled={loading || oidcLoading} /><div className="md:col-span-2"><Input label="Login Button Label" placeholder="Sign in with OIDC" value={oidcForm.oidcLoginLabel} onChange={(e) => updateOidcForm("oidcLoginLabel", e.target.value)} disabled={loading || oidcLoading} /></div></div><div className="flex flex-col gap-4 border-t border-dd-border-subtle pt-5"><p className="text-xs text-dd-muted">Only identities on these allowlists can sign in through OIDC. Separate entries with commas or new lines. Email and domain entries match only when the IdP reports email_verified.</p><div className="grid gap-4 md:grid-cols-3"><Textarea label="Allowed subjects" placeholder="sub claim values" rows={3} value={oidcForm.oidcAllowedSubjects} onChange={(e) => updateOidcForm("oidcAllowedSubjects", e.target.value)} disabled={loading || oidcLoading} /><Textarea label="Allowed emails" placeholder="ops@example.com" rows={3} value={oidcForm.oidcAllowedEmails} onChange={(e) => updateOidcForm("oidcAllowedEmails", e.target.value)} disabled={loading || oidcLoading} /><Textarea label="Allowed domains" placeholder="example.com" rows={3} value={oidcForm.oidcAllowedDomains} onChange={(e) => updateOidcForm("oidcAllowedDomains", e.target.value)} disabled={loading || oidcLoading} /></div>{!splitOidcAllowlist(oidcForm.oidcAllowedSubjects).length && !splitOidcAllowlist(oidcForm.oidcAllowedEmails).length && !splitOidcAllowlist(oidcForm.oidcAllowedDomains).length ? <p role="alert" className="text-xs text-dd-warning">OIDC allowlist is empty: every OIDC login will be refused until you add a subject, email or domain.</p> : null}</div><div className="rounded-dd bg-dd-surface-2 p-3"><p className="text-xs font-medium text-dd-muted">Redirect URI</p><code className="block break-all font-mono text-xs text-dd-text">{oidcRedirectUri}</code></div><div className="flex flex-wrap gap-2"><Button variant="primary" loading={oidcLoading} onClick={() => saveOidcSettings()}>Save auth mode</Button><Button variant="secondary" loading={oidcTestLoading} onClick={testOidcConnection}>Test connection</Button></div>{oidcTestStatus.message ? <p role="status" className={`text-xs ${statusClass(oidcTestStatus)}`}>{oidcTestStatus.message}</p> : null}{oidcStatus.message ? <p role="status" className={`text-xs ${statusClass(oidcStatus)}`}>{oidcStatus.message}</p> : null}{authAvailability.oidcAvailable && !authAvailability.passwordAvailable ? <p className="text-xs text-dd-warning">OIDC login is active. Password login is disabled until you switch back.</p> : null}{authAvailability.oidcAvailable && authAvailability.passwordAvailable ? <p className="text-xs text-dd-warning">Password and OIDC login are both active.</p> : null}</CardContent> : null}</Card>
  );
}
