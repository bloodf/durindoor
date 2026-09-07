"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/ui/components/Modal.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import {
  createOAuthFlowLifecycle,
  oauthProxySelection,
} from "@/shared/utils/oauthFlowLifecycle";

/**
 * Kiro Google/GitHub flow with one cancellable browser attempt at a time.
 * The server binds PKCE, provider, and proxy selection to the returned flow id.
 */
export default function KiroSocialOAuthModal({
  isOpen,
  provider,
  onSuccess,
  onClose,
  proxyPools = [],
  proxyPoolsReady = false,
}) {
  const [step, setStep] = useState("loading");
  const [authUrl, setAuthUrl] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [error, setError] = useState(null);
  const [selectedProxyPoolId, setSelectedProxyPoolId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { copied, copy } = useCopyToClipboard();
  const lifecycleRef = useRef(null);
  const selectedProxyPoolIdRef = useRef("");
  const cancelChainRef = useRef(Promise.resolve());
  const latestRef = useRef(null);
  if (lifecycleRef.current === null) lifecycleRef.current = createOAuthFlowLifecycle();

  useEffect(() => {
    latestRef.current = { isOpen, onClose, onSuccess, provider, proxyPoolsReady };
  }, [isOpen, onClose, onSuccess, provider, proxyPoolsReady]);

  const cancelServerFlow = useCallback((flow) => {
    const cancel = async () => {
      if (!flow?.flowId) return;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        await fetch("/api/oauth/kiro/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ flowId: flow.flowId, state: flow.expectedState }),
          signal: controller.signal,
        });
      } catch {
        // The flow may already have been consumed by a successful exchange.
      } finally {
        clearTimeout(timeout);
      }
    };
    cancelChainRef.current = cancelChainRef.current.then(cancel, cancel);
    return cancelChainRef.current;
  }, []);

  const finishError = useCallback((flow, message) => {
    if (lifecycleRef.current.settle(flow, () => {
      setError(message);
      setStep("error");
    })) {
      void cancelServerFlow(flow);
    }
  }, [cancelServerFlow]);

  const openTrackedPopup = useCallback((flow, url) => {
    if (!flow || !url) return null;
    const popup = window.open("", "kiro_oauth_popup", "width=600,height=700");
    if (popup) {
      try {
        popup.opener = null;
        popup.location.href = url;
      } catch {
        popup.close();
        return null;
      }
    }
    lifecycleRef.current.bindPopup(flow, popup);
    return popup;
  }, []);

  const startFlow = useCallback(async (flow) => {
    const lifecycle = lifecycleRef.current;
    try {
      const response = await fetch("/api/oauth/kiro/social-authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: flow.socialProvider,
          ownerId: flow.ownerId,
          ...oauthProxySelection(flow.proxyPoolId),
        }),
        signal: flow.controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to initialize Kiro authentication");
      if (!lifecycle.isActive(flow)) return;
      if (!lifecycle.bindFlowId(flow, data.flowId) || !lifecycle.bindState(flow, data.state)) {
        throw new Error("OAuth server returned an incomplete flow");
      }
      setAuthUrl(data.authUrl);
      setStep("input");
      openTrackedPopup(flow, data.authUrl);
    } catch (startError) {
      if (lifecycle.isActive(flow)) {
        finishError(flow, startError instanceof Error ? startError.message : "Authentication failed");
      }
    }
  }, [finishError, openTrackedPopup]);

  const restartFlow = useCallback(async (proxyPoolId) => {
    const options = latestRef.current;
    if (!options.isOpen || !options.provider || !options.proxyPoolsReady) return;
    selectedProxyPoolIdRef.current = proxyPoolId;
    setSelectedProxyPoolId(proxyPoolId);
    setAuthUrl("");
    setCallbackUrl("");
    setError(null);
    setStep("loading");
    const { flow, previous } = lifecycleRef.current.begin({
      proxyPoolId,
      socialProvider: options.provider,
    });
    await cancelServerFlow(previous);
    if (lifecycleRef.current.isActive(flow)) await startFlow(flow);
  }, [cancelServerFlow, startFlow]);

  useEffect(() => {
    if (isOpen && provider && proxyPoolsReady) {
      const timer = setTimeout(() => { void restartFlow(""); }, 0);
      return () => {
        clearTimeout(timer);
        const previous = lifecycleRef.current.cancel("flow-context-changed");
        void cancelServerFlow(previous);
      };
    }
    if (!isOpen) {
      selectedProxyPoolIdRef.current = "";
      const previous = lifecycleRef.current.cancel("modal-closed");
      void cancelServerFlow(previous);
    }
    return undefined;
  }, [cancelServerFlow, isOpen, provider, proxyPoolsReady, restartFlow]);

  useEffect(() => () => {
    const previous = lifecycleRef.current.cancel("unmounted");
    void cancelServerFlow(previous);
  }, [cancelServerFlow]);

  const handleManualSubmit = async () => {
    const lifecycle = lifecycleRef.current;
    const flow = lifecycle.current();
    if (!flow) return;
    setSubmitting(true);
    try {
      setError(null);
      const url = new URL(callbackUrl);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const callbackError = url.searchParams.get("error");
      if (callbackError) throw new Error(url.searchParams.get("error_description") || callbackError);
      if (!code) throw new Error("No authorization code found in URL");
      if (state !== flow.expectedState) {
        throw new Error("OAuth callback state did not match this login attempt");
      }
      if (!lifecycle.claimCallback(flow, { code, state })) return;

      const response = await fetch("/api/oauth/kiro/social-exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, state, flowId: flow.flowId }),
        signal: flow.controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Authentication failed");
      if (!lifecycle.isActive(flow)) return;
      if (lifecycle.settle(flow, () => {
        setStep("success");
        latestRef.current.onSuccess?.();
      })) {
        void cancelServerFlow(flow);
      }
    } catch (submitError) {
      if (lifecycle.isActive(flow)) {
        finishError(flow, submitError instanceof Error ? submitError.message : "Authentication failed");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = useCallback(async () => {
    const previous = lifecycleRef.current.cancel("user-closed");
    await cancelServerFlow(previous);
    latestRef.current.onClose();
  }, [cancelServerFlow]);

  const providerName = provider === "google" ? "Google" : "GitHub";
  const activeProxyPools = proxyPools.filter((pool) => pool.isActive === true);

  return (
    <Modal open={isOpen} title={`Connect Kiro via ${providerName}`} subtitle="Complete authentication in your browser, then paste callback URL." onClose={() => { void handleClose(); }} size="lg" pending={submitting} closeOnEscape={!submitting} closeOnOverlay={!submitting}>
      <div className="flex flex-col gap-5">
        {!proxyPoolsReady && <LoadingState title="Loading routing options…" />}

        {proxyPoolsReady && activeProxyPools.length > 0 && (step === "loading" || step === "input") && (
          <div className="flex flex-col gap-1.5 rounded-dd border border-dd-border bg-dd-surface-2 p-3">
            <label htmlFor="kiro-proxy-pool" className="text-xs font-medium text-dd-muted">Routing proxy pool</label>
            <Select id="kiro-proxy-pool" value={selectedProxyPoolId} disabled={submitting} onChange={(value) => { void restartFlow(value); }} options={[{ value: "", label: "Direct connection" }, ...activeProxyPools.map((pool) => ({ value: pool.id, label: pool.name }))]} />
          </div>
        )}

        {proxyPoolsReady && step === "loading" && <LoadingState title="Initializing…" message={`Setting up ${providerName} authentication`} />}

        {step === "input" && (
          <>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <p className="font-medium text-dd-text">1. Open this URL in your browser</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="flex-1"><Input value={authUrl} readOnly aria-label="Authorization URL" className="font-mono text-xs" /></div>
                  <Button variant="secondary" icon={copied === "auth_url" ? "check" : "content_copy"} disabled={submitting} onClick={() => copy(authUrl, "auth_url")}>Copy</Button>
                  <Button variant="ghost" icon="open_in_new" disabled={submitting} onClick={() => openTrackedPopup(lifecycleRef.current.current(), authUrl)}>Open</Button>
                </div>
              </div>
              <Input label="2. Paste callback URL" value={callbackUrl} disabled={submitting} onChange={(event) => setCallbackUrl(event.target.value)} placeholder="kiro://kiro.kiroAgent/authenticate-success?code=...&state=..." className="font-mono text-xs" />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => { void handleClose(); }} disabled={submitting}>Cancel</Button>
              <Button variant="primary" loading={submitting} disabled={!callbackUrl} onClick={() => { void handleManualSubmit(); }}>Connect</Button>
            </div>
          </>
        )}

        {step === "success" && (
          <ResultState tone="success" icon="check_circle" title="Connected successfully" message={`Kiro account via ${providerName} connected.`} actions={<Button variant="primary" onClick={() => { void handleClose(); }}>Done</Button>} />
        )}
        {step === "error" && (
          <ResultState tone="danger" icon="error" title="Connection failed" message={error} actions={<><Button variant="ghost" onClick={() => { void handleClose(); }}>Cancel</Button><Button variant="secondary" onClick={() => { void restartFlow(selectedProxyPoolIdRef.current); }}>Try again</Button></>} />
        )}
      </div>
    </Modal>
  );
}

function LoadingState({ title, message }) {
  return (
    <div role="status" aria-live="polite" className="py-8 text-center">
      <span aria-hidden="true" className="material-symbols-outlined animate-spin text-[32px] leading-none text-dd-accent">progress_activity</span>
      <h3 className="mt-3 font-semibold text-dd-text">{title}</h3>
      {message ? <p className="mt-1 text-xs text-dd-muted">{message}</p> : null}
    </div>
  );
}

function ResultState({ tone, icon, title, message, actions }) {
  const color = tone === "success" ? "text-dd-success" : "text-dd-danger";
  return (
    <div className="py-8 text-center">
      <span aria-hidden="true" className={`material-symbols-outlined text-[40px] leading-none ${color}`}>{icon}</span>
      <h3 className="mt-3 font-semibold text-dd-text">{title}</h3>
      <p role={tone === "danger" ? "alert" : undefined} aria-live={tone === "danger" ? "assertive" : undefined} className={`mt-1 text-[13px] ${color}`}>{message}</p>
      <div className="mt-5 flex flex-col-reverse justify-center gap-2 sm:flex-row">{actions}</div>
    </div>
  );
}

KiroSocialOAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.oneOf(["google", "github"]).isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
  proxyPools: PropTypes.arrayOf(PropTypes['shape']({
    id: PropTypes.string,
    name: PropTypes.string,
    isActive: PropTypes.bool,
  })),
  proxyPoolsReady: PropTypes.bool,
};
