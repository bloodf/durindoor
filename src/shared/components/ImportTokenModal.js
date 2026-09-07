"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/ui/components/Modal";
import Button from "@/shared/ui/components/Button";
import Input from "@/shared/ui/components/Input";

export default function ImportTokenModal({ isOpen, provider, providerInfo, onSuccess, onClose }) {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const reset = () => {
    setToken("");
    setLoading(false);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!token.trim()) {
      setError("Token is required");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/oauth/${provider}/import-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      onSuccess?.();
      handleClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={isOpen} title={`Connect ${providerInfo?.name || provider}`} onClose={handleClose} size="sm">
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3 rounded-dd border border-dd-border-subtle bg-dd-surface-2 p-3 text-dd-muted">
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">vpn_key</span>
          <p className="text-[13px] leading-relaxed">Paste your {providerInfo?.name || provider} access token to create a connection.</p>
        </div>
        <Input
          label="Access token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Paste token here"
          type="password"
          autoComplete="off"
          error={error || undefined}
        />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={handleClose} variant="ghost">Cancel</Button>
          <Button onClick={handleSubmit} variant="primary" disabled={!token.trim() || loading} loading={loading} icon="link">Connect</Button>
        </div>
      </div>
    </Modal>
  );
}

ImportTokenModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.string.isRequired,
  providerInfo: PropTypes.object,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
