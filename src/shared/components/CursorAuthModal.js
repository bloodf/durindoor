"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/ui/components/Modal.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Textarea from "@/shared/ui/components/Textarea.jsx";

/**
 * Cursor Auth Modal
 * Auto-detect and import token from Cursor IDE's local SQLite database
 */
export default function CursorAuthModal({ isOpen, onSuccess, onClose }) {
  const [accessToken, setAccessToken] = useState("");
  const [machineId, setMachineId] = useState("");
  const [error, setError] = useState(null);
  const [autoDetectError, setAutoDetectError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);
  const [windowsManual, setWindowsManual] = useState(false);

  const runAutoDetect = async () => {
    setAutoDetecting(true);
    setAutoDetectError(null);
    setAutoDetected(false);
    setWindowsManual(false);

    try {
      const res = await fetch("/api/oauth/cursor/auto-import");
      const data = await res.json();

      if (data.found) {
        setAccessToken(data.accessToken);
        setMachineId(data.machineId);
        setAutoDetected(true);
      } else if (data.windowsManual) {
        setWindowsManual(true);
      } else {
        setAutoDetectError(data.error || "Could not auto-detect tokens");
      }
    } catch (err) {
      setAutoDetectError("Failed to auto-detect tokens");
    } finally {
      setAutoDetecting(false);
    }
  };

  // Auto-detect tokens when modal opens
  useEffect(() => {
    if (!isOpen) return;
    runAutoDetect();
  }, [isOpen]);

  const handleImportToken = async () => {
    if (!accessToken.trim()) {
      setError("Please enter an access token");
      return;
    }

    if (!machineId.trim()) {
      setError("Please enter a machine ID");
      return;
    }

    setImporting(true);
    setError(null);
    setAutoDetectError(null);

    try {
      const res = await fetch("/api/oauth/cursor/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: accessToken.trim(),
          machineId: machineId.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal open={isOpen} title="Connect Cursor IDE" subtitle="Detect or paste tokens from Cursor IDE." onClose={onClose} pending={importing} closeOnEscape={!importing} closeOnOverlay={!importing}>
      <div className="flex flex-col gap-4">
        {autoDetecting ? <LoadingState title="Auto-detecting tokens…" message="Reading from Cursor IDE database" /> : <>
          {autoDetected ? <Notice tone="success" icon="check_circle" message="Tokens auto-detected from Cursor IDE successfully." /> : null}
          {windowsManual ? <div className="flex flex-col gap-2"><Notice tone="warning" icon="info" message="Could not read Cursor database automatically." /><p className="text-xs text-dd-muted">Make sure Cursor IDE has been opened at least once, then click <strong>Retry</strong>. If the problem persists, paste your tokens manually below.</p><Button variant="secondary" onClick={runAutoDetect}>Retry</Button></div> : null}
          {!autoDetected && !windowsManual && !autoDetectError ? <Notice tone="info" icon="info" message="Cursor IDE not detected. Please paste your tokens manually." /> : null}
          {autoDetectError ? <p role="alert" className="rounded-dd border border-dd-danger/30 bg-dd-danger/10 p-3 text-[13px] text-dd-danger">{autoDetectError}</p> : null}
          <Textarea label="Access Token" required value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder="Access token will be auto-filled..." rows={3} className="resize-none font-mono" error={error} />
          <Input label="Machine ID" required value={machineId} onChange={(event) => setMachineId(event.target.value)} placeholder="Machine ID will be auto-filled..." className="font-mono" />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="ghost" onClick={onClose} disabled={importing}>Cancel</Button><Button variant="primary" loading={importing} disabled={!accessToken.trim() || !machineId.trim()} onClick={handleImportToken}>Import Token</Button></div>
        </>}
      </div>
    </Modal>
  );
}

function Notice({ tone, icon, message }) {
  const tones = { info: "border-dd-info/30 bg-dd-info/10 text-dd-info", success: "border-dd-success/30 bg-dd-success/10 text-dd-success", warning: "border-dd-warning/30 bg-dd-warning/10 text-dd-warning" };
  return <div className={`flex gap-2 rounded-dd border p-3 text-[13px] ${tones[tone]}`}><span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">{icon}</span><p>{message}</p></div>;
}

function LoadingState({ title, message }) {
  return <div role="status" aria-live="polite" className="py-8 text-center"><span aria-hidden="true" className="material-symbols-outlined animate-spin text-[32px] leading-none text-dd-accent">progress_activity</span><h3 className="mt-3 font-semibold text-dd-text">{title}</h3><p className="mt-1 text-xs text-dd-muted">{message}</p></div>;
}

CursorAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
