"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import Button from "@/shared/ui/components/Button.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import Textarea from "@/shared/ui/components/Textarea.jsx";
import { translate } from "@/i18n/runtime";
import { isFunction, isObject } from "../../../../../shared/utils/typeChecks.js";

const PLACEHOLDER = `{
  "accounts": [
    {
      "access_token": "eyJhbGc...",
      "refresh_token": "rt_...",
      "id_token": "eyJhbGc..."
    }
  ]
}`;

function normalizeAccounts(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && isObject(parsed)) {
    if (Array.isArray(parsed.accounts)) return parsed.accounts;
    return [parsed];
  }
  return null;
}

/** Dashboard importer for one or many existing Grok CLI device-code credential objects. */
export default function BulkImportGrokCliModal({ isOpen, onClose, onSuccess }) {
  const [jsonText, setJsonText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const handleClose = () => {
    if (submitting) return;
    setJsonText("");
    setError("");
    setResult(null);
    onClose();
  };

  const handleSubmit = async () => {
    setError("");
    setResult(null);

    let accounts;
    try {
      accounts = normalizeAccounts(JSON.parse(jsonText.trim()));
    } catch (parseError) {
      setError(`${translate("Invalid JSON")}: ${parseError.message}`);
      return;
    }
    if (!accounts?.length) {
      setError(translate("No accounts found in input"));
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/oauth/grok-cli/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error || `Request failed: ${response.status}`);
        return;
      }
      setResult(data);
      if (data.success > 0 && isFunction(onSuccess)) onSuccess();
    } catch (requestError) {
      setError(requestError.message || translate("Request failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const failedItems = result?.results?.filter((item) => !item.ok) || [];

  return (
    <Modal open={isOpen} title={translate("Bulk Add Grok CLI Accounts")} onClose={handleClose}>
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-dd-muted">
          {translate("Paste one Grok CLI credential object, an array, or an object containing accounts. Snake-case and camelCase token keys are accepted.")}
        </p>
        <Textarea
          label={translate("Grok CLI accounts JSON")}
          placeholder={PLACEHOLDER}
          value={jsonText}
          onChange={(event) => setJsonText(event.target.value)}
          disabled={submitting}
          className="min-h-[240px] font-mono"
        />
        {error ? <p className="text-xs text-dd-danger break-words" role="alert">{error}</p> : null}
        {result ? (
          <div className="flex flex-col gap-2">
            <p className={`text-sm font-medium ${result.failed ? "text-dd-warning" : "text-dd-success"}`}>
              {result.success} {translate("added")}{result.failed ? `, ${result.failed} ${translate("failed")}` : ""}
            </p>
            {failedItems.length > 0 ? (
              <ul className="max-h-40 overflow-y-auto rounded-dd border border-dd-border bg-dd-surface-2 p-2 font-mono text-xs">
                {failedItems.map((item) => (
                  <li key={item.index} className="text-dd-danger">[{item.index}] {item.error}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button variant="primary" onClick={handleSubmit} className="w-full" loading={submitting} disabled={submitting || !jsonText.trim()}>
            {submitting ? translate("Importing...") : translate("Import All")}
          </Button>
          <Button onClick={handleClose} variant="ghost" className="w-full" disabled={submitting}>
            {translate("Close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

BulkImportGrokCliModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
};
