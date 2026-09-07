"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/ui/components/Modal";
import Button from "@/shared/ui/components/Button";
import Input from "@/shared/ui/components/Input";
import OAuthModal from "./OAuthModal";
import { isBrowser } from "../utils/typeChecks.js";

const GITLAB_COM = "https://gitlab.com";

function getRedirectUri() {
  if (!isBrowser()) return "http://localhost/callback";
  const port = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
  return `http://localhost:${port}/callback`;
}

/**
 * GitLab Duo Authentication Modal
 * Supports two modes:
 * - OAuth (PKCE): requires OAuth App Client ID (and optional Client Secret)
 * - PAT: requires Personal Access Token
 */
export default function GitLabAuthModal({
  isOpen,
  provider,
  providerInfo,
  onSuccess,
  onClose,
  proxyPools = [],
  proxyPoolsReady = false
}) {
  const providerId = provider || "gitlab";
  const [mode, setMode] = useState(null); // null | "oauth" | "pat"
  const [baseUrl, setBaseUrl] = useState(GITLAB_COM);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [pat, setPat] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showOAuth, setShowOAuth] = useState(false);
  const [oauthMeta, setOauthMeta] = useState(null);

  const reset = () => {
    setMode(null);
    setBaseUrl(GITLAB_COM);
    setClientId("");
    setClientSecret("");
    setPat("");
    setError(null);
    setLoading(false);
    setShowOAuth(false);
    setOauthMeta(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleOAuthStart = () => {
    if (!clientId.trim()) {
      setError("Client ID is required");
      return;
    }
    setError(null);
    setOauthMeta({ baseUrl: baseUrl.trim() || GITLAB_COM, clientId: clientId.trim(), clientSecret: clientSecret.trim() });
    setShowOAuth(true);
  };

  const handlePATSubmit = async () => {
    if (!pat.trim()) {
      setError("Personal Access Token is required");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/oauth/gitlab/pat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, token: pat.trim(), baseUrl: baseUrl.trim() || GITLAB_COM })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Authentication failed");
      onSuccess?.();
      handleClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  if (!isOpen) return null;

  // Sub-modal for OAuth PKCE flow
  if (showOAuth && oauthMeta) {
    return (
      <OAuthModal
        isOpen
        provider={providerId}
        providerInfo={providerInfo}
        oauthMeta={oauthMeta}
        proxyPools={proxyPools}
        proxyPoolsReady={proxyPoolsReady}
        onSuccess={() => {onSuccess?.();handleClose();}}
        onClose={() => {setShowOAuth(false);setOauthMeta(null);}} />);


  }

  return (
    <Modal open={isOpen} title="Connect GitLab Duo" onClose={handleClose} size="lg">
      <div className="flex flex-col gap-5">
        {!mode && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-dd-muted">
              Choose how to authenticate with GitLab Duo:
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMode("oauth")}
                className="flex flex-col items-start gap-2 rounded-dd border border-dd-border bg-dd-surface-2 p-4 text-left outline-none transition-colors hover:border-dd-accent hover:bg-dd-surface-3 focus-visible:shadow-dd-focus"
              >
                <span className="flex size-9 items-center justify-center rounded-dd bg-dd-accent-soft text-dd-accent">
                  <span className="material-symbols-outlined text-[20px] leading-none" aria-hidden="true">lock_open</span>
                </span>
                <p className="text-sm font-medium text-dd-text">OAuth app</p>
                <p className="text-xs text-dd-muted">Use a GitLab OAuth application</p>
              </button>
              <button
                type="button"
                onClick={() => setMode("pat")}
                className="flex flex-col items-start gap-2 rounded-dd border border-dd-border bg-dd-surface-2 p-4 text-left outline-none transition-colors hover:border-dd-accent hover:bg-dd-surface-3 focus-visible:shadow-dd-focus"
              >
                <span className="flex size-9 items-center justify-center rounded-dd bg-dd-accent-soft text-dd-accent">
                  <span className="material-symbols-outlined text-[20px] leading-none" aria-hidden="true">key</span>
                </span>
                <p className="text-sm font-medium text-dd-text">Personal access token</p>
                <p className="text-xs text-dd-muted">Use a GitLab PAT with api scope</p>
              </button>
            </div>
          </div>
        )}

        {mode === "oauth" && (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-dd-muted">
              Create an OAuth app at{" "}
              <a
                href={`${baseUrl.trim() || GITLAB_COM}/-/profile/applications`}
                target="_blank"
                rel="noreferrer"
                className="text-dd-accent underline outline-none focus-visible:shadow-dd-focus"
              >
                GitLab applications
              </a>{" "}
              with redirect URI{" "}
              <code className="rounded-dd bg-dd-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-dd-text">{getRedirectUri()}</code>
            </p>
            <Input label="GitLab base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={GITLAB_COM} />
            <Input label="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Your OAuth application client ID" />
            <Input
              label="Client secret (optional for PKCE)"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Leave empty for public PKCE app"
              type="password"
              autoComplete="off"
            />
            {error && <p className="text-xs text-dd-danger" role="alert">{error}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button onClick={() => {setMode(null);setError(null);}} variant="ghost">Back</Button>
              <Button onClick={handleOAuthStart} variant="primary" disabled={!clientId.trim()} icon="lock_open">Authorize</Button>
            </div>
          </div>
        )}

        {mode === "pat" && (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-dd-muted">
              Create a PAT at{" "}
              <a
                href={`${baseUrl.trim() || GITLAB_COM}/-/user_settings/personal_access_tokens`}
                target="_blank"
                rel="noreferrer"
                className="text-dd-accent underline outline-none focus-visible:shadow-dd-focus"
              >
                GitLab access tokens
              </a>{" "}
              with scopes: <code className="rounded-dd bg-dd-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-dd-text">api</code>,{" "}
              <code className="rounded-dd bg-dd-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-dd-text">read_user</code>, and{" "}
              <code className="rounded-dd bg-dd-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-dd-text">ai_features</code>.
            </p>
            <Input label="GitLab base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={GITLAB_COM} />
            <Input
              label="Personal access token"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
              type="password"
              autoComplete="off"
              error={error || undefined}
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button onClick={() => {setMode(null);setError(null);}} variant="ghost">Back</Button>
              <Button onClick={handlePATSubmit} variant="primary" disabled={!pat.trim() || loading} loading={loading} icon="key">Connect</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

GitLabAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.string,
  providerInfo: PropTypes['shape']({ name: PropTypes.string }),
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
  proxyPools: PropTypes.arrayOf(PropTypes['shape']({
    id: PropTypes.string,
    name: PropTypes.string,
    isActive: PropTypes.bool
  })),
  proxyPoolsReady: PropTypes.bool
};