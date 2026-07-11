"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "@/shared/components";
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
    <Modal isOpen={isOpen} title={`Connect Kiro via ${providerName}`} onClose={() => { void handleClose(); }} size="lg">
      <div className="flex flex-col gap-4">
        {!proxyPoolsReady && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-text-muted">
            <span className="material-symbols-outlined animate-spin">progress_activity</span>
            Loading routing options…
          </div>
        )}

        {proxyPoolsReady && activeProxyPools.length > 0 && (step === "loading" || step === "input") && (
          <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-sidebar/30 p-3">
            <label className="text-xs font-medium uppercase tracking-wider text-text-muted">Routing Proxy Pool</label>
            <select
              value={selectedProxyPoolId}
              onChange={(event) => { void restartFlow(event.target.value); }}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="">Direct Connection</option>
              {activeProxyPools.map((pool) => (
                <option key={pool.id} value={pool.id}>{pool.name}</option>
              ))}
            </select>
          </div>
        )}

        {proxyPoolsReady && step === "loading" && (
          <div className="py-6 text-center">
            <span className="material-symbols-outlined text-3xl text-primary animate-spin">progress_activity</span>
            <h3 className="mb-2 mt-3 text-lg font-semibold">Initializing…</h3>
            <p className="text-sm text-text-muted">Setting up {providerName} authentication</p>
          </div>
        )}

        {step === "input" && (
          <>
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-sm font-medium">Step 1: Open this URL in your browser</p>
                <div className="flex gap-2">
                  <Input value={authUrl} readOnly className="flex-1 font-mono text-xs" />
                  <Button
                    variant="secondary"
                    icon={copied === "auth_url" ? "check" : "content_copy"}
                    onClick={() => copy(authUrl, "auth_url")}
                  >
                    Copy
                  </Button>
                  <Button
                    variant="ghost"
                    icon="open_in_new"
                    onClick={() => openTrackedPopup(lifecycleRef.current.current(), authUrl)}
                  >
                    Open
                  </Button>
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Step 2: Paste the callback URL here</p>
                <Input
                  value={callbackUrl}
                  onChange={(event) => setCallbackUrl(event.target.value)}
                  placeholder="kiro://kiro.kiroAgent/authenticate-success?code=...&state=..."
                  className="font-mono text-xs"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => { void handleManualSubmit(); }} fullWidth disabled={!callbackUrl}>Connect</Button>
              <Button onClick={() => { void handleClose(); }} variant="ghost" fullWidth>Cancel</Button>
            </div>
          </>
        )}

        {step === "success" && (
          <div className="py-6 text-center">
            <span className="material-symbols-outlined text-5xl text-green-600">check_circle</span>
            <h3 className="mb-2 mt-3 text-lg font-semibold">Connected Successfully!</h3>
            <p className="mb-4 text-sm text-text-muted">Your Kiro account via {providerName} has been connected.</p>
            <Button onClick={() => { void handleClose(); }} fullWidth>Done</Button>
          </div>
        )}

        {step === "error" && (
          <div className="py-6 text-center">
            <span className="material-symbols-outlined text-5xl text-red-600">error</span>
            <h3 className="mb-2 mt-3 text-lg font-semibold">Connection Failed</h3>
            <p className="mb-4 text-sm text-red-600">{error}</p>
            <div className="flex gap-2">
              <Button onClick={() => { void restartFlow(selectedProxyPoolIdRef.current); }} variant="secondary" fullWidth>Try Again</Button>
              <Button onClick={() => { void handleClose(); }} variant="ghost" fullWidth>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

KiroSocialOAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.oneOf(["google", "github"]).isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
  proxyPools: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    isActive: PropTypes.bool,
  })),
  proxyPoolsReady: PropTypes.bool,
};
