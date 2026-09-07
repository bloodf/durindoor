"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/ui/components/Modal.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Textarea from "@/shared/ui/components/Textarea.jsx";

/**
 * Kiro Auth Method Selection Modal
 * Auto-detects token from AWS SSO cache or allows manual import
 */
function Notice({ tone, icon, message }) {
  const tones = { info: "border-dd-info/30 bg-dd-info/10 text-dd-info", success: "border-dd-success/30 bg-dd-success/10 text-dd-success", warning: "border-dd-warning/30 bg-dd-warning/10 text-dd-warning" };
  return <div className={`flex gap-2 rounded-dd border p-3 text-[13px] ${tones[tone]}`}><span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">{icon}</span><p>{message}</p></div>;
}

function LoadingState({ title, message }) {
  return <div role="status" aria-live="polite" className="py-8 text-center"><span aria-hidden="true" className="material-symbols-outlined animate-spin text-[32px] leading-none text-dd-accent">progress_activity</span><h3 className="mt-3 font-semibold text-dd-text">{title}</h3><p className="mt-1 text-xs text-dd-muted">{message}</p></div>;
}
export default function KiroAuthModal({ isOpen, onMethodSelect, onClose }) {
  const [selectedMethod, setSelectedMethod] = useState(null);
  const [idcStartUrl, setIdcStartUrl] = useState("");
  const [idcRegion, setIdcRegion] = useState("us-east-1");
  const [refreshToken, setRefreshToken] = useState("");
  const [cliProxyJson, setCliProxyJson] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyRegion, setApiKeyRegion] = useState("us-east-1");
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);
  const [idcCredentials, setIdcCredentials] = useState(null);

  // Auto-detect token when import method is selected
  useEffect(() => {
    if (selectedMethod !== "import" || !isOpen) return;

    const autoDetect = async () => {
      setAutoDetecting(true);
      setError(null);
      setAutoDetected(false);
      setIdcCredentials(null);

      try {
        const res = await fetch("/api/oauth/kiro/auto-import");
        const data = await res.json();

        if (data.found) {
          setRefreshToken(data.refreshToken);
          setAutoDetected(true);
          // Store IDC/organization credentials if present
          if (data.clientId && data.clientSecret) {
            setIdcCredentials({
              clientId: data.clientId,
              clientSecret: data.clientSecret,
              region: data.region,
              authMethod: data.authMethod,
              profileArn: data.profileArn,
            });
          }
        } else {
          setError(data.error || "Could not auto-detect token");
        }
      } catch (err) {
        setError("Failed to auto-detect token");
      } finally {
        setAutoDetecting(false);
      }
    };

    autoDetect();
  }, [selectedMethod, isOpen]);

  const handleMethodSelect = (method) => {
    setSelectedMethod(method);
    setError(null);
  };

  const handleBack = () => {
    setSelectedMethod(null);
    setError(null);
  };

  const handleImportToken = async () => {
    if (!refreshToken.trim()) {
      setError("Please enter a refresh token");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/kiro/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refreshToken: refreshToken.trim(),
          ...(idcCredentials || {}),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      // Success - notify parent to refresh connections
      onMethodSelect("import");
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleImportCliProxyJson = async () => {
    if (!cliProxyJson.trim()) {
      setError("Please paste CLIProxyAPI auth JSON");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/kiro/import-cli-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: cliProxyJson.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "CLIProxyAPI import failed");
      }

      onMethodSelect("import-cli-proxy");
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleIdcContinue = () => {
    if (!idcStartUrl.trim()) {
      setError("Please enter your IDC start URL");
      return;
    }
    onMethodSelect("idc", { startUrl: idcStartUrl.trim(), region: idcRegion });
  };

  const handleApiKeyImport = async () => {
    if (!apiKey.trim()) {
      setError("Please enter an API key");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/kiro/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          region: apiKeyRegion.trim() || "us-east-1",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      // Success - notify parent to refresh connections
      onMethodSelect("api-key");
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleSocialLogin = (provider) => {
    onMethodSelect("social", { provider });
  };

  const methodOptions = [
    ["builder-id", "shield", "AWS Builder ID", "Recommended for most users. Free AWS account required."],
    ["idc", "business", "AWS IAM Identity Center", "For enterprise users with custom AWS IAM Identity Center."],
    ["api-key", "key", "API Key", "Use a long-lived Kiro/CodeWhisperer API key (headless auth)."],
    ["import", "file_upload", "Import Token", "Paste refresh token from Kiro IDE."],
    ["import-cli-proxy", "data_object", "Import CLIProxyAPI JSON", "Paste external_idp auth JSON from CLIProxyAPI/Kiro Microsoft login."],
    ["social-google", "account_circle", "Google Account", "Login with your Google account (manual callback).", true],
    ["social-github", "code", "GitHub Account", "Login with your GitHub account (manual callback).", true],
  ];

  return (
    <Modal open={isOpen} title="Connect Kiro" subtitle="Choose a secure Kiro authentication method." onClose={onClose} size="lg" pending={importing} closeOnEscape={!importing} closeOnOverlay={!importing}>
      <div className="flex flex-col gap-5">
        {!selectedMethod && (
          <div className="grid gap-2 sm:grid-cols-2">
            {methodOptions.map(([method, icon, title, description, hidden]) => (
              <button key={method} hidden={hidden} type="button" onClick={() => method === "builder-id" ? onMethodSelect(method) : handleMethodSelect(method)} className="flex min-h-11 w-full items-start gap-3 rounded-dd border border-dd-border bg-dd-surface p-4 text-start text-[13px] text-dd-text outline-none transition-colors hover:bg-dd-surface-2 focus-visible:shadow-dd-focus">
                <span aria-hidden="true" className="material-symbols-outlined mt-0.5 text-[20px] leading-none text-dd-accent">{icon}</span>
                <span className="min-w-0"><span className="block font-semibold">{title}</span><span className="mt-1 block text-xs leading-relaxed text-dd-muted">{description}</span></span>
              </button>
            ))}
          </div>
        )}

        {selectedMethod === "idc" && <div className="flex flex-col gap-4">
          <Input label="IDC Start URL" required value={idcStartUrl} onChange={(event) => setIdcStartUrl(event.target.value)} placeholder="https://your-org.awsapps.com/start" className="font-mono" hint="Your organization’s AWS IAM Identity Center URL." error={error} />
          <Input label="AWS Region" value={idcRegion} onChange={(event) => setIdcRegion(event.target.value)} placeholder="us-east-1" className="font-mono" hint="AWS region for your Identity Center." />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="ghost" onClick={handleBack}>Back</Button><Button variant="primary" onClick={handleIdcContinue}>Continue</Button></div>
        </div>}

        {selectedMethod === "api-key" && <div className="flex flex-col gap-4">
          <Notice tone="info" icon="info" message="Paste a long-lived Kiro/CodeWhisperer API key. It is validated against AWS and stored directly as a bearer credential." />
          <Input label="API Key" required value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Paste your Kiro API key..." className="font-mono" error={error} />
          <Input label="AWS Region" value={apiKeyRegion} onChange={(event) => setApiKeyRegion(event.target.value)} placeholder="us-east-1" className="font-mono" hint="AWS region for key." />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="ghost" onClick={handleBack} disabled={importing}>Back</Button><Button variant="primary" loading={importing} disabled={!apiKey.trim()} onClick={handleApiKeyImport}>Add API Key</Button></div>
        </div>}

        {(selectedMethod === "social-google" || selectedMethod === "social-github") && <div className="flex flex-col gap-4"><Notice tone="warning" icon="info" message="After login, copy callback URL from browser and paste it back here." /><div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="ghost" onClick={handleBack}>Back</Button><Button variant="primary" onClick={() => handleSocialLogin(selectedMethod === "social-google" ? "google" : "github")}>Continue with {selectedMethod === "social-google" ? "Google" : "GitHub"}</Button></div></div>}

        {selectedMethod === "import" && <div className="flex flex-col gap-4">
          {autoDetecting ? <LoadingState title="Auto-detecting token…" message="Reading from AWS SSO cache" /> : <>
            {autoDetected ? <Notice tone="success" icon="check_circle" message="Token auto-detected from Kiro IDE successfully." /> : !error ? <Notice tone="info" icon="info" message="Kiro IDE not detected. Paste refresh token manually." /> : null}
            <Input label="Refresh Token" required value={refreshToken} onChange={(event) => setRefreshToken(event.target.value)} placeholder="Token will be auto-filled..." className="font-mono" error={error} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="ghost" onClick={handleBack} disabled={importing}>Back</Button><Button variant="primary" loading={importing} disabled={!refreshToken.trim()} onClick={handleImportToken}>Import Token</Button></div>
          </>}
        </div>}

        {selectedMethod === "import-cli-proxy" && <div className="flex flex-col gap-4">
          <Notice tone="info" icon="info" message="Paste Kiro CLIProxyAPI auth JSON containing auth_method=external_idp. Only Microsoft login token endpoints are accepted." />
          <Textarea label="CLIProxyAPI Auth JSON" required value={cliProxyJson} onChange={(event) => setCliProxyJson(event.target.value)} placeholder={'{"auth_method":"external_idp","access_token":"..."}'} className="font-mono" error={error} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="ghost" onClick={handleBack} disabled={importing}>Back</Button><Button variant="primary" loading={importing} disabled={!cliProxyJson.trim()} onClick={handleImportCliProxyJson}>Import CLIProxyAPI JSON</Button></div>
        </div>}
      </div>
    </Modal>
  );
}

KiroAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onMethodSelect: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
