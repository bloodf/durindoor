"use client";

import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";

import { useRef, useState } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/ui/components/Modal";
import Button from "@/shared/ui/components/Button";
import Input from "@/shared/ui/components/Input";
import { isString } from "../utils/typeChecks.js";

const PROVIDER = "copilot-m365-web";
/** Microsoft's fixed native-client callback. It serves nothing; the user copies its request URL. */
export const M365_NATIVE_CALLBACK = "https://login.microsoftonline.com/common/oauth2/nativeclient";

/** Mirror of the server check, for an early hint only: the server validates the URL again. */
export function isM365CallbackUrl(value) {
  const raw = String(value || "").trim();
  return raw.startsWith(`${M365_NATIVE_CALLBACK}?`) && /[?&]code=/.test(raw) && !raw.includes("#");
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    // An empty or non-JSON body keeps the status-based message below.
  }
  if (!response.ok) {
    const message = isString(data?.error) ? data.error : data?.error?.message;
    throw new Error(message || `Request failed (${response.status})`);
  }
  return data;
}

/**
 * Microsoft 365 Copilot native sign-in: an authorization-code flow with PKCE against the Microsoft
 * identity platform, for work or school accounts. The dialog asks the server to prepare an attempt
 * (the PKCE verifier stays on the server), shows the sign-in URL, and exchanges the native-client
 * callback URL the user copies from the browser's Network log.
 */
export default function CopilotM365AuthModal({ isOpen, providerInfo, connectionId = null, onSuccess, onClose }) {
  const uiV5 = useUiV5();
  const [flow, setFlow] = useState(null); // { authUrl, state, flowId }
  const [callbackUrl, setCallbackUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const generationRef = useRef(0);

  const reset = () => {
    generationRef.current += 1;
    setFlow(null);
    setCallbackUrl("");
    setLoading(false);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleStart = async () => {
    const generation = ++generationRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await postJson(`/api/oauth/${PROVIDER}/authorize`, connectionId ? { connectionId } : {});
      if (generation !== generationRef.current) return;
      if (!data?.authUrl || !data?.state || !data?.flowId) throw new Error("Sign-in could not be prepared");
      setFlow({ authUrl: data.authUrl, state: data.state, flowId: data.flowId });
    } catch (err) {
      if (generation === generationRef.current) setError(err.message);
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  };

  const handleExchange = async () => {
    if (!flow) return;
    const code = callbackUrl.trim();
    if (!isM365CallbackUrl(code)) {
      setError("Paste the full request URL that starts with the Microsoft native-client address");
      return;
    }
    const generation = generationRef.current;
    setLoading(true);
    setError(null);
    try {
      await postJson(`/api/oauth/${PROVIDER}/exchange`, { code, state: flow.state, flowId: flow.flowId });
      if (generation !== generationRef.current) return;
      onSuccess?.();
      handleClose();
    } catch (err) {
      if (generation === generationRef.current) {
        setError(err.message);
        setLoading(false);
      }
    }
  };

  if (!isOpen) return null;

  const title = `Sign in to ${providerInfo?.name || "Microsoft 365 Copilot"}`;
  return (
    <Modal {...(uiV5 ? { surfaceClassName: "max-[480px]:max-h-[calc(100dvh-2rem)] max-[480px]:w-full max-[480px]:max-w-none border-dd-border bg-dd-surface shadow-dd-elevated [&>header]:bg-dd-surface-2" } : {})} open={isOpen} title={title} onClose={handleClose} size="lg">
      <div className="flex flex-col gap-4">
        {!flow &&
        <>
            <p className="text-[13px] text-dd-muted">
              Sign in with a work or school Microsoft account. DurinDoor never sees your password or MFA code,
              and the connection renews its own token. Personal Microsoft accounts are not accepted.
            </p>
            {error && <p className="text-xs text-dd-danger" role="alert">{error}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button onClick={handleClose} variant="ghost">Cancel</Button>
              <Button onClick={handleStart} variant="primary" loading={loading} disabled={loading} icon="login">Start sign-in</Button>
            </div>
          </>
        }

        {flow &&
        <>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-[13px] text-dd-muted">
              <li>Open a blank browser tab, open <strong className="text-dd-text">DevTools → Network</strong> and enable <strong className="text-dd-text">Preserve log</strong>.</li>
              <li>
                In that tab, open the{" "}
                <a
                href={flow.authUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-dd-accent underline outline-none focus-visible:shadow-dd-focus">
                  Microsoft sign-in page
                </a>{" "}
                and finish account selection or MFA.
              </li>
              <li>
                In the Network log, find the request to{" "}
                <code className="rounded-dd bg-dd-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-dd-text">{M365_NATIVE_CALLBACK}</code>{" "}
                and copy its full Request URL. The address bar URL is not usable.
              </li>
            </ol>
            <Input
            label="Callback URL"
            value={callbackUrl}
            onChange={(e) => setCallbackUrl(e.target.value)}
            placeholder={`${M365_NATIVE_CALLBACK}?code=…`}
            type="password"
            autoComplete="off"
            error={error || undefined} />
            <p className="text-xs text-dd-muted">The URL is a one-time credential. Do not share it.</p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button onClick={reset} variant="ghost" disabled={loading}>Start over</Button>
              <Button onClick={handleExchange} variant="primary" loading={loading} disabled={!callbackUrl.trim() || loading} icon="lock_open">Connect</Button>
            </div>
          </>
        }
      </div>
    </Modal>);

}

CopilotM365AuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerInfo: PropTypes['shape']({ name: PropTypes.string }),
  connectionId: PropTypes.string,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired
};
