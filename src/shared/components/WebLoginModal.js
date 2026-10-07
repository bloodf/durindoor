"use client";

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/ui/components/Modal.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import Input from "@/shared/ui/components/Input.jsx";

const API = "/api/providers/web-login";

async function request(action, provider, extra = {}) {
  const response = await fetch(`${API}/${action}`, action === "status" ? {
    cache: "no-store",
  } : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, ...extra }),
    keepalive: action === "cancel",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Web login request failed.");
  return data;
}

function isolatedPageUrl(value) {
  const url = new URL(value);
  const dashboard = new URL(window.location.href);
  if (!["https:", "http:"].includes(url.protocol) || url.hostname === dashboard.hostname || url.username || url.password) {
    throw new Error("Login requires a separate, configured hostname. Use manual cookie paste instead.");
  }
  return url.href;
}

export default function WebLoginModal({ isOpen, provider, providerName, initialName = "", onSuccess, onClose }) {
  const [pageUrl, setPageUrl] = useState(null);
  const [name, setName] = useState(initialName);
  const [captured, setCaptured] = useState([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [popupBusy, setPopupBusy] = useState(false);
  const sessionRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const previous = sessionRef.current;
    const session = { active: true, started: false, finished: false, timer: null, popup: null };
    sessionRef.current = session;
    setPageUrl(null);
    setName(initialName);
    setCaptured([]);
    setReady(false);
    setError("");
    setSaving(false);
    setPopupBusy(false);
    const cancel = () => request("cancel", provider).catch(() => {});
    const poll = async () => {
      try {
        const status = await request("status", provider);
        if (!session.active || session.finished) return;
        if (status.provider !== provider) throw new Error("Login session changed. Close and start again.");
        setCaptured(status.captured || []);
        setReady(status.ready === true);
        setError("");
      } catch (err) {
        if (!session.active || session.finished) return;
        setReady(false);
        setError(err.message);
      }
      if (session.active && !session.finished) session.timer = setTimeout(poll, 2000);
    };
    // A rapid close/reopen must finish cancelling the old session before start
    // replaces the operator's session cookie (also covers StrictMode remounts).
    session.startPromise = Promise.resolve(previous?.cleanupPromise).then(() => {
      if (session.active) return request("start", provider);
    }).then((data) => {
      if (!data) return;
      session.started = true;
      if (!session.active) return;
      setPageUrl(isolatedPageUrl(data.pageUrl));
      session.timer = setTimeout(poll, 2000);
    }).catch((err) => {
      if (session.active) setError(err.message);
    });
    const dispose = () => {
      if (!session.active) return;
      session.active = false;
      clearTimeout(session.timer);
      session.popup?.close();
      session.cleanupPromise = session.startPromise.then(() => {
        if (session.started && !session.finished) return cancel();
      });
    };
    const restore = (event) => {
      // BFCache preserves React state, but pagehide already cancelled authority.
      // Return to manual entry rather than showing a stale, inactive login.
      if (event.persisted && !session.active) onCloseRef.current();
    };
    window.addEventListener("pagehide", dispose);
    window.addEventListener("pageshow", restore);
    return () => {
      window.removeEventListener("pagehide", dispose);
      window.removeEventListener("pageshow", restore);
      dispose();
    };
    // initialName seeds this session only; editing the parent form must not restart login.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, provider]);
  const openPopup = async () => {
    const session = sessionRef.current;
    // Preopen from the gesture, then sever the opener before any remote document
    // loads. Opening with the noopener feature directly returns no usable handle.
    const popup = window.open("about:blank", "_blank", "popup,width=600,height=760");
    if (!popup) {
      setError("Popup blocked. Allow popups for this dashboard or use manual cookie paste.");
      return;
    }
    popup.opener = null;
    const referrer = popup.document.createElement("meta");
    referrer.name = "referrer";
    referrer.content = "no-referrer";
    popup.document.head.appendChild(referrer);
    session.popup?.close();
    session.popup = popup;
    setPopupBusy(true);
    setError("");
    try {
      const data = await request("popup", provider);
      if (!session.active) return popup.close();
      popup.location.replace(isolatedPageUrl(data.pageUrl));
    } catch (err) {
      popup.close();
      if (session.active) setError(err.message);
    } finally {
      if (session.active) setPopupBusy(false);
    }
  };

  const save = async () => {
    if (!ready || !name.trim() || saving) return;
    const session = sessionRef.current;
    setSaving(true);
    setError("");
    try {
      const connection = await request("finish", provider, { name: name.trim() });
      session.finished = true;
      clearTimeout(session.timer);
      if (session.active) {
        onSuccess?.(connection);
        onClose();
      }
    } catch (err) {
      if (session.active) setError(err.message);
    } finally {
      if (session.active) setSaving(false);
    }
  };

  return (
    <Modal open={isOpen} title={`Sign in to ${providerName || provider}`} size="xl" onClose={onClose} pending={saving}
      footer={<><Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={save} loading={saving} disabled={!ready || !name.trim() || saving}>Save connection</Button></>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-dd-muted">Sign in on the isolated login page. If the site refuses to load, try a popup or cancel and paste your cookie manually.</p>
        <Input label="Connection name" value={name} onChange={(event) => setName(event.target.value)} disabled={saving} />
        {error ? <p role="alert" className="text-sm text-dd-danger">{error}</p> : null}
        <p role="status" className="text-sm text-dd-muted">{ready ? "Ready to save." : pageUrl ? "Waiting for sign-in…" : "Starting login…"} Captured cookies: {captured.length ? captured.join(", ") : "none"}</p>
        <Button variant="secondary" className="min-h-11 self-start" onClick={openPopup} disabled={!pageUrl || popupBusy || saving} loading={popupBusy}>Open in popup</Button>
        {pageUrl ? <iframe title={`${providerName || provider} login`} src={pageUrl} sandbox="allow-forms allow-scripts allow-same-origin allow-popups" referrerPolicy="no-referrer" className="h-[55vh] min-h-80 w-full rounded-dd-lg border border-dd-border bg-white" /> : null}
      </div>
    </Modal>
  );
}

WebLoginModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.string.isRequired,
  providerName: PropTypes.string,
  initialName: PropTypes.string,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
