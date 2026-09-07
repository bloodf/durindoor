"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import Button from "@/shared/ui/components/Button.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Textarea from "@/shared/ui/components/Textarea.jsx";
import { translate } from "@/i18n/runtime";
import { isFunction, isObject } from "../../../../../shared/utils/typeChecks.js";

const PLACEHOLDER = `[
  {
    "accessToken": "eyJhbGc...",
    "refreshToken": "rt_...",
    "idToken": "eyJhbGc...",
    "email": "user@example.com"
  }
]`;


function normalizeToArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && isObject(parsed)) {
    if (Array.isArray(parsed.accounts)) return parsed.accounts;
    return [parsed];
  }
  return null;
}

export default function BulkImportCodexModal({ isOpen, onClose, onSuccess }) {
  const [jsonText, setJsonText] = useState("");
  const [codexFingerprintMode, setCodexFingerprintMode] = useState("session");
  const [submitting, setSubmitting] = useState(false);
  const [parseError, setParseError] = useState("");
  const [result, setResult] = useState(null);
  const fingerprintOptions = [
    { value: "off", label: translate("Off — preserve client identity") },
    { value: "device", label: translate("Device — stable installation") },
    { value: "session", label: translate("Session — stable account session (recommended)") },
    { value: "full", label: translate("Full — stable account thread") },
  ];

  const handleClose = () => {
    if (submitting) return;
    setJsonText("");
    setCodexFingerprintMode("session");
    setParseError("");
    setResult(null);
    onClose();
  };

  const handleSubmit = async () => {
    setParseError("");
    setResult(null);

    const trimmed = jsonText.trim();
    if (!trimmed) return;

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      setParseError(`${translate("Invalid JSON")}: ${err.message}`);
      return;
    }

    const accounts = normalizeToArray(parsed);
    if (!accounts || accounts.length === 0) {
      setParseError(translate("No accounts found in input"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/oauth/codex/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts, codexFingerprintMode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setParseError(data?.error || `Request failed: ${res.status}`);
        return;
      }
      setResult(data);
      if (data.success > 0 && isFunction(onSuccess)) {
        onSuccess();
      }
    } catch (err) {
      setParseError(err.message || translate("Request failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const failedItems = result?.results?.filter((r) => !r.ok) || [];

  return (
    <Modal open={isOpen} title={translate("Bulk Add Codex Accounts")} onClose={handleClose}>
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-dd-muted">
          {translate(
            "Paste an array of codex account JSON objects. Each must include accessToken (and ideally refreshToken, idToken).",
          )}
        </p>
        <Select
          options={fingerprintOptions}
          value={codexFingerprintMode}
          onChange={(value) => setCodexFingerprintMode(value)}
          disabled={submitting}
          aria-label={translate("OAuth fingerprint mode")}
        />

        <Textarea
          label={translate("Account JSON")}
          placeholder={PLACEHOLDER}
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          disabled={submitting}
          className="min-h-[240px] font-mono"
        />

        {parseError ? (
          <p className="text-xs text-dd-danger break-words" role="alert">
            {parseError}
          </p>
        ) : null}

        {result ? (
          <div className="flex flex-col gap-2">
            <div
              className={`text-sm font-medium ${
                result.failed > 0 ? "text-dd-warning" : "text-dd-success"
              }`}
            >
              ✓ {result.success} {translate("added")}
              {result.failed > 0 ? `, ✗ ${result.failed} ${translate("failed")}` : ""}
            </div>
            {failedItems.length > 0 ? (
              <ul className="max-h-40 overflow-y-auto rounded-dd border border-dd-border bg-dd-surface-2 p-2 font-mono text-xs">
                {failedItems.map((item) => (
                  <li key={item.index} className="text-dd-danger">
                    [{item.index}] {item.error}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="flex gap-2">
          <Button
            variant="primary"
            onClick={handleSubmit}
            className="w-full"
            loading={submitting}
            disabled={submitting || !jsonText.trim()}
          >
            {submitting ? translate("Importing...") : translate("Import All")}
          </Button>
          <Button variant="ghost" onClick={handleClose} className="w-full" disabled={submitting}>
            {translate("Close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

BulkImportCodexModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
};
