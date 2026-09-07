"use client";

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/ui/components/Modal";
import Button from "@/shared/ui/components/Button";
import Textarea from "@/shared/ui/components/Textarea";

/**
 * iFlow Cookie Authentication Modal
 * User pastes browser cookie to get fresh API key
 */
export default function IFlowCookieModal({ isOpen, onSuccess, onClose }) {
  const [cookie, setCookie] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const successTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(successTimerRef.current), []);
  useEffect(() => {
    if (!isOpen) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!cookie.trim()) {
      setError("Please paste your cookie");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/iflow/cookie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookie: cookie.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Authentication failed");
      }

      setSuccess(true);
      successTimerRef.current = setTimeout(() => {
        onSuccess?.();
        handleClose();
      }, 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    clearTimeout(successTimerRef.current);
    successTimerRef.current = null;
    setCookie("");
    setError(null);
    setSuccess(false);
    onClose?.();
  };

  return (
    <Modal open={isOpen} onClose={handleClose} title="iFlow Cookie Authentication" size="sm">
      <div className="flex flex-col gap-4">
        {success ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="flex size-12 items-center justify-center rounded-dd-lg bg-dd-success/10 text-dd-success">
              <span className="material-symbols-outlined text-[24px] leading-none" aria-hidden="true">check_circle</span>
            </span>
            <p className="text-sm font-semibold text-dd-text">Authentication successful!</p>
            <p className="text-[13px] text-dd-muted">Fresh API key obtained</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <p className="text-[13px] text-dd-muted">
                To get a fresh API key, paste your browser cookie from{" "}
                <a
                  href="https://platform.iflow.cn"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-dd-accent underline outline-none focus-visible:shadow-dd-focus"
                >
                  platform.iflow.cn
                </a>
              </p>
              <div className="flex flex-col gap-1.5 rounded-dd border border-dd-border-subtle bg-dd-surface-2 p-3 text-xs">
                <p className="font-medium text-dd-text">How to get cookie:</p>
                <ol className="list-inside list-decimal space-y-1 text-dd-muted">
                  <li>Open platform.iflow.cn in your browser</li>
                  <li>Login to your account</li>
                  <li>Open DevTools (F12) → Application/Storage → Cookies</li>
                  <li>Copy the entire cookie string (must include BXAuth)</li>
                  <li>Paste it below</li>
                </ol>
              </div>
            </div>

            <Textarea
              label="Cookie string"
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              placeholder="BXAuth=xxx; ..."
              rows={4}
              disabled={loading}
              error={error || undefined}
            />

            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={handleClose} disabled={loading}>Cancel</Button>
              <Button variant="primary" onClick={handleSubmit} loading={loading} icon="key">Authenticate</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

IFlowCookieModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func,
};
