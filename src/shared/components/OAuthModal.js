"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/ui/components/Modal";
import Button from "@/shared/ui/components/Button";
import Input from "@/shared/ui/components/Input";
import Select from "@/shared/ui/components/Select";
import IconButton from "@/shared/ui/components/IconButton";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import {
  createOAuthFlowLifecycle,
  oauthProxySelection
} from "@/shared/utils/oauthFlowLifecycle";

const DEVICE_CODE_PROVIDERS = new Set([
"github",
"qwen",
"kiro",
"kimi-coding",
"kilocode",
"codebuddy-cn",
"qoder",
"grok-cli"]
);
const FIXED_PORT_PROVIDERS = new Set(["codex", "xai"]);
const STATELESS_CALLBACK_PROVIDERS = new Set(["cline", "clinepass"]);
function isLoopbackHostname(hostname) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}


function errorMessage(error, fallback = "Authentication failed") {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Authentication failed (${response.status})`);
  return data;
}

/**
 * Runs an OAuth attempt as a single cancellable generation.
 *
 * Proxy selection is captured when the generation starts. Later callbacks use
 * only the server-issued flow id, so a stale render or browser event cannot
 * replace routing, PKCE, redirect, or provider metadata during exchange.
 */
export default function OAuthModal({
  isOpen,
  provider,
  providerInfo,
  onSuccess,
  onClose,
  oauthMeta,
  idcConfig,
  proxyPools = [],
  proxyPoolsReady = false,
  connectionId = null
}) {
  const [step, setStep] = useState("waiting");
  const [authData, setAuthData] = useState(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [error, setError] = useState(null);
  const [isDeviceCode, setIsDeviceCode] = useState(false);
  const [deviceData, setDeviceData] = useState(null);
  const [polling, setPolling] = useState(false);
  const [selectedProxyPoolId, setSelectedProxyPoolId] = useState("");
  const [codexFingerprintMode, setCodexFingerprintMode] = useState("session");
  const { copied, copy } = useCopyToClipboard();

  const lifecycleRef = useRef(null);
  const selectedProxyPoolIdRef = useRef("");
  const closingRef = useRef(false);
  const stopChainRef = useRef(Promise.resolve());
  const latestRef = useRef(null);
  if (lifecycleRef.current === null) lifecycleRef.current = createOAuthFlowLifecycle();

  useEffect(() => {
    latestRef.current = {
      idcConfig,
      isOpen,
      oauthMeta,
      onClose,
      onSuccess,
      provider,
      proxyPoolsReady,
      connectionId,
      codexFingerprintMode
    };
  }, [codexFingerprintMode, idcConfig, isOpen, oauthMeta, onClose, onSuccess, provider, proxyPoolsReady, connectionId]);

  const resetView = useCallback(() => {
    setAuthData(null);
    setCallbackUrl("");
    setDeviceData(null);
    setError(null);
    setIsDeviceCode(false);
    setPolling(false);
    setStep("waiting");
  }, []);

  const stopFixedProxy = useCallback((flow) => {
    const stop = async () => {
      if (!flow?.flowId) return;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        const action = FIXED_PORT_PROVIDERS.has(flow.provider) ? "stop-proxy" : "cancel";
        await fetch(`/api/oauth/${flow.provider}/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            flowId: flow.flowId,
            state: flow.expectedState
          }),
          signal: controller.signal
        });
      } catch {


        // The flow may already be consumed, or the callback server may have
        // stopped itself. Cancellation is bounded so a restart cannot hang.
      } finally {clearTimeout(timeout);}
    };
    stopChainRef.current = stopChainRef.current.then(stop, stop);
    return stopChainRef.current;
  }, []);

  const finishSuccess = useCallback((flow) => {
    if (lifecycleRef.current.settle(flow, () => {
      setPolling(false);
      setStep("success");
      latestRef.current.onSuccess?.();
    })) {
      void stopFixedProxy(flow);
    }
  }, [stopFixedProxy]);

  const finishError = useCallback((flow, message) => {
    if (lifecycleRef.current.settle(flow, () => {
      setPolling(false);
      setError(message);
      setStep("error");
    })) {
      void stopFixedProxy(flow);
    }
  }, [stopFixedProxy]);

  const exchangeClaimedCallback = useCallback(async (flow, code, state, endpoint = "exchange") => {
    const lifecycle = lifecycleRef.current;
    try {
      const response = await fetch(`/api/oauth/${flow.provider}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, state, flowId: flow.flowId }),
        signal: flow.controller.signal
      });
      await readJson(response);
      if (lifecycle.isActive(flow)) finishSuccess(flow);
    } catch (exchangeError) {
      if (lifecycle.isActive(flow)) finishError(flow, errorMessage(exchangeError));
    }
  }, [finishError, finishSuccess]);

  const processCallback = useCallback((flow, data, options) => {
    const lifecycle = lifecycleRef.current;
    if (!lifecycle.claimCallback(flow, data, options)) return;
    if (data.error) {
      finishError(flow, data.errorDescription || data.error);
      return;
    }
    const code = data.token || data.code;
    if (!code) {
      finishError(flow, "OAuth callback did not contain an authorization code");
      return;
    }
    void exchangeClaimedCallback(flow, code, data.state);
  }, [exchangeClaimedCallback, finishError]);

  const pollDeviceCode = useCallback(async (flow, initialInterval, expiresInSeconds) => {
    const lifecycle = lifecycleRef.current;
    let interval = Number.isFinite(initialInterval) && initialInterval > 0 ? initialInterval : 5;
    const durationMs = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ?
    expiresInSeconds * 1000 :
    120_000;
    const deadline = Date.now() + durationMs;
    setPolling(true);

    while (lifecycle.isActive(flow) && Date.now() < deadline) {
      if (!(await lifecycle.wait(flow, interval * 1000))) return;
      try {
        const response = await fetch(`/api/oauth/${flow.provider}/poll`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ flowId: flow.flowId }),
          signal: flow.controller.signal
        });
        const data = await response.json().catch(() => ({}));
        if (!lifecycle.isActive(flow)) return;
        if (data.success) {
          finishSuccess(flow);
          return;
        }
        if (data.error === "slow_down") {
          interval = Math.min(interval + 5, 30);
          continue;
        }
        if (data.error === "authorization_pending" || !data.error && response.ok) continue;
        throw new Error(data.errorDescription || data.error || `Authentication failed (${response.status})`);
      } catch (pollError) {
        if (lifecycle.isActive(flow)) finishError(flow, errorMessage(pollError));
        return;
      }
    }
    if (lifecycle.isActive(flow)) finishError(flow, "Authorization timeout");
  }, [finishError, finishSuccess]);

  const pollFixedPortStatus = useCallback(async (flow) => {
    const lifecycle = lifecycleRef.current;
    for (let attempt = 0; attempt < 200 && lifecycle.isActive(flow); attempt += 1) {
      if (!(await lifecycle.wait(flow, 1500))) return;
      try {
        const response = await fetch(`/api/oauth/${flow.provider}/poll-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            flowId: flow.flowId,
            state: flow.expectedState
          }),
          signal: flow.controller.signal
        });
        const data = await response.json().catch(() => ({}));
        if (!lifecycle.isActive(flow)) return;
        if (data.status === "done") {
          finishSuccess(flow);
          return;
        }
        if (data.status === "error") {
          finishError(flow, data.error || "Authentication failed");
          return;
        }
      } catch (pollError) {
        if (pollError?.name === "AbortError") return;
        // A temporary local-server/network error should not end the flow.
      }
    }
    if (lifecycle.isActive(flow)) finishError(flow, "Authentication timeout");
  }, [finishError, finishSuccess]);

  const startOAuthFlow = useCallback(async (flow) => {
    const lifecycle = lifecycleRef.current;
    const options = latestRef.current;
    const selection = oauthProxySelection(flow.proxyPoolId);
    try {
      if (DEVICE_CODE_PROVIDERS.has(flow.provider)) {
        setIsDeviceCode(true);
        const request = {
          ...selection,
          ownerId: flow.ownerId,
          ...(flow.provider === "kiro" && options.idcConfig?.startUrl ?
          {
            startUrl: options.idcConfig.startUrl,
            region: options.idcConfig.region,
            authMethod: "idc"
          } : null)

        };
        const response = await fetch(`/api/oauth/${flow.provider}/device-code`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: flow.controller.signal
        });
        const data = await readJson(response);
        if (!lifecycle.isActive(flow)) return;
        if (!lifecycle.bindFlowId(flow, data.flowId)) {
          throw new Error("OAuth server did not return a flow id");
        }
        setDeviceData(data);
        const verificationUrl = data.verification_uri_complete || data.verification_uri;
        if (verificationUrl) window.open(verificationUrl, "_blank", "noopener,noreferrer");
        void pollDeviceCode(flow, data.interval, data.expires_in);
        return;
      }

      const appPort = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
      const redirectUri = flow.provider === "codex" ?
      "http://localhost:1455/auth/callback" :
      flow.provider === "xai" ?
      "http://127.0.0.1:56121/callback" :
      `http://localhost:${appPort}/callback`;
      const response = await fetch(`/api/oauth/${flow.provider}/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirectUri,
          ownerId: flow.ownerId,
          ...selection,
          ...(options.oauthMeta ? { meta: options.oauthMeta } : null),
          ...(flow.provider === "codex" ? { codexFingerprintMode: options.codexFingerprintMode } : null),
          ...(options.connectionId ? { connectionId: options.connectionId } : null)
        }),
        signal: flow.controller.signal
      });
      const data = await readJson(response);
      if (!lifecycle.isActive(flow)) return;
      if (!lifecycle.bindState(flow, data.state) || !lifecycle.bindFlowId(flow, data.flowId)) {
        throw new Error("OAuth server returned an incomplete flow");
      }
      if (!data.authUrl) {
        if (data.flowType === "device_code") {
          throw new Error(`Provider ${flow.provider} uses device login but is not wired in the OAuth modal`);
        }
        throw new Error("No authorization URL returned from OAuth provider");
      }

      const browserIsLoopback = isLoopbackHostname(window.location.hostname);
      let fixedProxyActive = false;
      let serverSide = false;
      if (FIXED_PORT_PROVIDERS.has(flow.provider) && (flow.provider !== "codex" || browserIsLoopback)) {
        const proxyResponse = await fetch(`/api/oauth/${flow.provider}/start-proxy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ flowId: flow.flowId, appPort }),
          signal: flow.controller.signal
        });
        const proxyData = await proxyResponse.json().catch(() => ({}));
        if (!lifecycle.isActive(flow)) {
          await stopFixedProxy(flow);
          return;
        }
        if (proxyData.success !== true || proxyData.serverSide !== true) {
          const port = flow.provider === "xai" ? "56121" : "1455";
          const reason = proxyData.reason === "port_busy" ?
          `Port ${port} is in use; close the conflicting process and retry` :
          "Could not bind the fixed OAuth callback to this login attempt";
          throw new Error(reason);
        }
        fixedProxyActive = proxyData.success === true;
        serverSide = proxyData.serverSide === true;
        flow.fixedProxySession = fixedProxyActive && serverSide;
      }

      setAuthData({
        authUrl: data.authUrl,
        flowId: flow.flowId,
        state: data.state,
        codexServerSide: flow.provider === "codex" && serverSide,
        xaiServerSide: flow.provider === "xai" && serverSide
      });
      const isLocalhost = browserIsLoopback;
      const canUsePopup = fixedProxyActive ||
      !FIXED_PORT_PROVIDERS.has(flow.provider) && isLocalhost;
      if (canUsePopup) {
        const popup = window.open(data.authUrl, "oauth_popup", "width=600,height=700");
        lifecycle.bindPopup(flow, popup);
        setStep(popup ? "waiting" : "input");
      } else {
        setStep("input");
        window.open(data.authUrl, "_blank", "noopener,noreferrer");
      }
      if (serverSide) void pollFixedPortStatus(flow);
    } catch (startError) {
      if (lifecycle.isActive(flow)) finishError(flow, errorMessage(startError));
    }
  }, [finishError, pollDeviceCode, pollFixedPortStatus, stopFixedProxy]);

  const restartFlow = useCallback(async (proxyPoolId) => {
    const options = latestRef.current;
    if (!options.isOpen || !options.provider || !options.proxyPoolsReady) return;
    selectedProxyPoolIdRef.current = proxyPoolId;
    setSelectedProxyPoolId(proxyPoolId);
    resetView();
    const { flow, previous } = lifecycleRef.current.begin({
      provider: options.provider,
      proxyPoolId
    });
    await stopFixedProxy(previous);
    if (!lifecycleRef.current.isActive(flow)) return;
    await startOAuthFlow(flow);
  }, [resetView, startOAuthFlow, stopFixedProxy]);

  useEffect(() => {
    if (isOpen && provider && proxyPoolsReady) {
      // Deferring one task lets React StrictMode run its probe cleanup before
      // any irreversible device-code/provider request leaves the browser.
      const timer = setTimeout(() => {void restartFlow("");}, 0);
      return () => {
        clearTimeout(timer);
        const previous = lifecycleRef.current.cancel("flow-context-changed");
        void stopFixedProxy(previous);
      };
    }
    if (!isOpen) {
      selectedProxyPoolIdRef.current = "";
      const previous = lifecycleRef.current.cancel("modal-closed");
      void stopFixedProxy(previous);
    }
    return undefined;
  }, [isOpen, provider, proxyPoolsReady, restartFlow, stopFixedProxy]);

  useEffect(() => () => {
    const previous = lifecycleRef.current.cancel("unmounted");
    void stopFixedProxy(previous);
  }, [stopFixedProxy]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleMessage = (event) => {
      const lifecycle = lifecycleRef.current;
      const flow = lifecycle.current();
      let callbackEvent = event;
      if (
      flow &&
      STATELESS_CALLBACK_PROVIDERS.has(flow.provider) &&
      !event?.data?.data?.state &&
      event?.origin === window.location.origin &&
      event?.source === flow.popup &&
      event?.data?.type === "oauth_callback")
      {
        callbackEvent = {
          ...event,
          data: {
            ...event.data,
            data: { ...event.data.data, state: flow.expectedState }
          }
        };
      }
      if (!lifecycle.acceptsPostMessage(flow, callbackEvent, window.location.origin)) return;
      processCallback(flow, callbackEvent.data.data);
    };
    const handleFreshCallback = (data) => {
      const lifecycle = lifecycleRef.current;
      const flow = lifecycle.current();
      if (!lifecycle.acceptsCallback(flow, data, { requireFresh: true })) return;
      processCallback(flow, data, { requireFresh: true });
    };
    const handleStorage = (event) => {
      if (event.key !== "oauth_callback" || !event.newValue) return;
      try {
        handleFreshCallback(JSON.parse(event.newValue));
      } catch {

        // Ignore malformed cross-tab callback data.
      } finally {localStorage.removeItem("oauth_callback");
      }
    };

    window.addEventListener("message", handleMessage);
    window.addEventListener("storage", handleStorage);
    let channel = null;
    try {
      channel = new BroadcastChannel("oauth_callback");
      channel.onmessage = (event) => handleFreshCallback(event.data);
    } catch {

      // BroadcastChannel is optional; postMessage/localStorage remain available.
    }try {
      const stored = localStorage.getItem("oauth_callback");
      if (stored) handleFreshCallback(JSON.parse(stored));
      localStorage.removeItem("oauth_callback");
    } catch {

      // localStorage may be disabled.
    }
    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("storage", handleStorage);
      channel?.close();
    };
  }, [isOpen, processCallback]);

  const handleProxyPoolChange = (proxyPoolId) => {
    void restartFlow(proxyPoolId);
  };

  const handleCodexFingerprintModeChange = (mode) => {
    setCodexFingerprintMode(mode);
    if (latestRef.current) latestRef.current.codexFingerprintMode = mode;
    void restartFlow(selectedProxyPoolIdRef.current);
  };

  const handleManualSubmit = async () => {
    const lifecycle = lifecycleRef.current;
    const flow = lifecycle.current();
    if (!flow?.expectedState) return;
    try {
      setError(null);
      const input = callbackUrl.trim();
      if (input.startsWith("eyJ") && input.includes(".")) {
        const callback = { code: input, state: flow.expectedState };
        if (lifecycle.claimCallback(flow, callback)) {
          await exchangeClaimedCallback(flow, input, flow.expectedState);
        }
        return;
      }
      if (provider === "xai" && input && !input.includes("://") && !input.includes("?") && !input.includes("code=")) {
        const callback = { code: input, state: flow.expectedState };
        if (lifecycle.claimCallback(flow, callback)) {
          await exchangeClaimedCallback(
            flow,
            input,
            flow.expectedState,
            flow.fixedProxySession ? "manual-code" : "exchange"
          );
        }
        return;
      }
      if (provider === "kimchi" && input && !input.includes("://") && !input.includes("?")) {
        const callback = { code: input, state: flow.expectedState };
        if (lifecycle.claimCallback(flow, callback)) {
          await exchangeClaimedCallback(flow, input, flow.expectedState);
        }
        return;
      }

      const url = new URL(input);
      const code = url.searchParams.get("code");
      const token = url.searchParams.get("token");
      const state = url.searchParams.get("state") || (
      STATELESS_CALLBACK_PROVIDERS.has(provider) ? flow.expectedState : null);
      const callbackError = url.searchParams.get("error");
      if (callbackError) throw new Error(url.searchParams.get("error_description") || callbackError);
      if (!code && !token) {
        throw new Error(
          provider === "xai" ?
          "Paste the callback URL or copied xAI code" :
          provider === "kimchi" ?
          "No Kimchi token found in URL" :
          "No authorization code found in URL"
        );
      }
      if (state !== flow.expectedState) {
        throw new Error("OAuth callback state did not match this login attempt");
      }
      processCallback(flow, { code: token || code, state });
    } catch (manualError) {
      if (lifecycle.isActive(flow)) finishError(flow, errorMessage(manualError));
    }
  };

  const handleClose = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    const previous = lifecycleRef.current.cancel("user-closed");
    await stopFixedProxy(previous);
    closingRef.current = false;
    latestRef.current.onClose();
  }, [stopFixedProxy]);

  if (!provider || !providerInfo) return null;
  const isXaiProvider = provider === "xai";
  const isKimchiProvider = provider === "kimchi";
  const deviceLoginUrl = deviceData?.verification_uri_complete || deviceData?.verification_uri || "";
  const modalTitle = isXaiProvider ? "Connect Grok Build OAuth" : `Connect ${providerInfo.name}`;
  const manualPlaceholder = isXaiProvider ?
  "http://127.0.0.1:56121/callback?code=... or copied code" :
  isKimchiProvider ?
  "/callback?token=... or copied token" :
  "/callback?code=...";
  const activeProxyPools = proxyPools.filter((pool) => pool.isActive === true);

  return (
    <Modal open={isOpen} title={modalTitle} onClose={() => {void handleClose();}} size="lg">
      <div className="flex flex-col gap-5">
        {!proxyPoolsReady && (
          <div className="flex items-center gap-2 rounded-dd border border-dd-border-subtle bg-dd-surface-2 px-3 py-2.5 text-[13px] text-dd-muted">
            <span className="material-symbols-outlined animate-spin text-[18px] leading-none" aria-hidden="true">progress_activity</span>
            <span>Loading routing options…</span>
          </div>
        )}

        {proxyPoolsReady && activeProxyPools.length > 0 && (step === "waiting" || step === "input") && (
          <div className="flex flex-col gap-1.5 rounded-dd border border-dd-border-subtle bg-dd-surface-2 p-3">
            <label className="text-xs font-medium uppercase tracking-wider text-dd-muted">
              Routing proxy pool
            </label>
            <Select
              value={selectedProxyPoolId || ""}
              onChange={handleProxyPoolChange}
              aria-label="Routing proxy pool"
              options={[
                { value: "", label: "Direct connection" },
                ...activeProxyPools.map((pool) => ({ value: pool.id, label: pool.name }))
              ]}
            />
          </div>
        )}

        {provider === "codex" && proxyPoolsReady && (step === "waiting" || step === "input") && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-dd-muted">OAuth fingerprint mode</span>
            <Select
              value={codexFingerprintMode}
              onChange={handleCodexFingerprintModeChange}
              aria-label="OAuth fingerprint mode"
              options={[
                { value: "off", label: "Off — preserve client identity" },
                { value: "device", label: "Device — stable installation" },
                { value: "session", label: "Session — stable account session (recommended)" },
                { value: "full", label: "Full — stable account thread" }
              ]}
            />
          </div>
        )}

        {proxyPoolsReady && (step === "waiting" || step === "input") && !isDeviceCode && (
          <>
            <div className="flex flex-col gap-3 rounded-dd border border-dd-border-subtle bg-dd-surface-2 px-3 py-2.5">
              {step === "waiting" && (
                <div className="flex items-center gap-2 text-[13px] text-dd-text">
                  <span className="material-symbols-outlined animate-spin text-[18px] leading-none text-dd-accent" aria-hidden="true">progress_activity</span>
                  <span>{isXaiProvider ? "Waiting for Grok Build OAuth…" : "Waiting for popup authorization…"}</span>
                </div>
              )}
              {authData?.authUrl && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <Input
                      value={authData.authUrl}
                      readOnly
                      className="font-mono text-[12px]"
                      aria-label="Authorization URL"
                    />
                  </div>
                  <Button
                    variant="secondary"
                    icon={copied === "auth_url" ? "check" : "content_copy"}
                    onClick={() => copy(authData.authUrl, "auth_url")}
                  >
                    Copy
                  </Button>
                  <Button
                    variant="ghost"
                    icon="open_in_new"
                    onClick={() => window.open(authData.authUrl, "_blank", "noopener,noreferrer")}
                  >
                    Open
                  </Button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-dd-border" />
              <span className="text-xs uppercase tracking-wider text-dd-muted">Paste callback URL manually</span>
              <div className="h-px flex-1 bg-dd-border" />
            </div>

            <div className="flex flex-col gap-1.5">
              <p className="text-[13px] font-medium text-dd-text">
                Paste the {provider === "xai" ? "callback URL or copied code" : isKimchiProvider ? "callback URL or copied token" : "callback URL"} here
              </p>
              <p className="text-xs text-dd-muted">
                {provider === "xai"
                  ? "If xAI shows a code instead of redirecting, paste that code here."
                  : isKimchiProvider
                  ? "After authorization, copy the full callback URL or token from your browser."
                  : "After authorization, copy the full URL from your browser."}
              </p>
              <Input
                value={callbackUrl}
                onChange={(event) => setCallbackUrl(event.target.value)}
                placeholder={manualPlaceholder}
                className="font-mono text-[12px]"
                aria-label="Callback URL"
              />
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button onClick={() => {void handleClose();}} variant="ghost">Cancel</Button>
              <Button
                onClick={() => {void handleManualSubmit();}}
                variant="primary"
                disabled={!callbackUrl || !authData}
                icon="link"
              >
                Connect
              </Button>
            </div>
          </>
        )}

        {proxyPoolsReady && step === "waiting" && isDeviceCode && deviceData && (
          <>
            <div className="flex flex-col gap-4 py-2 text-center">
              <p className="text-[13px] text-dd-muted">Visit the login URL below and authorize:</p>
              <div className="rounded-dd border border-dd-border-subtle bg-dd-surface-2 p-4 text-left">
                <p className="mb-1 text-xs font-medium uppercase tracking-wider text-dd-muted">Login URL</p>
                <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                  <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-dd-text">{deviceLoginUrl}</code>
                  <IconButton
                    icon={copied === "login_url" ? "check" : "content_copy"}
                    label="Copy login URL"
                    onClick={() => copy(deviceLoginUrl, "login_url")}
                    disabled={!deviceLoginUrl}
                  />
                  <IconButton
                    icon="open_in_new"
                    label="Open login URL"
                    onClick={() => window.open(deviceLoginUrl, "_blank", "noopener,noreferrer")}
                    disabled={!deviceLoginUrl}
                  />
                </div>
              </div>
              <div className="rounded-dd border border-dd-accent/40 bg-dd-accent-soft p-4 text-left">
                <p className="mb-1 text-xs font-medium uppercase tracking-wider text-dd-muted">Your code</p>
                <div className="flex items-center justify-between gap-2">
                  <p className="flex-1 text-center font-mono text-2xl font-bold tracking-widest text-dd-accent">{deviceData.user_code}</p>
                  <IconButton
                    icon={copied === "user_code" ? "check" : "content_copy"}
                    label="Copy device code"
                    onClick={() => copy(deviceData.user_code, "user_code")}
                  />
                </div>
              </div>
            </div>
            {polling && (
              <div className="flex items-center justify-center gap-2 text-[13px] text-dd-muted">
                <span className="material-symbols-outlined animate-spin text-[18px] leading-none" aria-hidden="true">progress_activity</span>
                <span>Waiting for authorization…</span>
              </div>
            )}
            <Button onClick={() => {void handleClose();}} variant="ghost">Cancel</Button>
          </>
        )}

        {step === "success" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-dd-success/10 text-dd-success">
              <span className="material-symbols-outlined text-[32px] leading-none" aria-hidden="true">check_circle</span>
            </span>
            <h3 className="text-base font-semibold text-dd-text">Connected successfully!</h3>
            <p className="text-[13px] text-dd-muted">Your {providerInfo.name} account has been connected.</p>
            <Button onClick={() => {void handleClose();}} variant="primary" className="w-full sm:w-auto">Done</Button>
          </div>
        )}

        {step === "error" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-dd-danger/10 text-dd-danger">
              <span className="material-symbols-outlined text-[32px] leading-none" aria-hidden="true">error</span>
            </span>
            <h3 className="text-base font-semibold text-dd-text">Connection failed</h3>
            <p className="text-[13px] text-dd-danger" role="alert">{error}</p>
            <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-center">
              <Button onClick={() => {void handleClose();}} variant="ghost">Cancel</Button>
              <Button
                onClick={() => {void restartFlow(selectedProxyPoolIdRef.current);}}
                variant="secondary"
                icon="refresh"
              >
                Try again
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>);

}

OAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.string,
  providerInfo: PropTypes['shape']({ name: PropTypes.string }),
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
  /** Extra metadata bound to the server-side flow during authorization. */
  oauthMeta: PropTypes.object,
  /** Optional Kiro IAM Identity Center device-flow configuration. */
  idcConfig: PropTypes['shape']({
    startUrl: PropTypes.string,
    region: PropTypes.string
  }),
  /** Active proxy pools offered as explicit strict-routing choices. */
  proxyPools: PropTypes.arrayOf(PropTypes['shape']({
    id: PropTypes.string,
    name: PropTypes.string,
    isActive: PropTypes.bool
  })),
  /** Prevents a flow from starting before the async pool lookup completes. */
  proxyPoolsReady: PropTypes.bool,
  /** When set, the flow replaces this existing connection in place (Reconnect). */
  connectionId: PropTypes.string
};