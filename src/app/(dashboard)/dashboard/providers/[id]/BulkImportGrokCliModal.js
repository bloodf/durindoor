"use client";

import { useState } from "react";
import { Button, Modal } from "@/shared/components";
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
    <Modal isOpen={isOpen} title={translate("Bulk Add Grok CLI Accounts")} onClose={handleClose}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-muted">
          {translate("Paste one Grok CLI credential object, an array, or an object containing accounts. Snake-case and camelCase token keys are accepted.")}
        </p>
        <textarea
          className="w-full rounded border border-accent/30 bg-sidebar p-2 text-sm font-mono resize-y min-h-[240px] focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder={PLACEHOLDER}
          value={jsonText}
          onChange={(event) => setJsonText(event.target.value)}
          disabled={submitting}
          aria-label={translate("Grok CLI accounts JSON")}
        />
        {error && <p className="text-xs text-red-500 break-words">{error}</p>}
        {result && (
          <div className="flex flex-col gap-2">
            <p className={`text-sm font-medium ${result.failed ? "text-yellow-400" : "text-green-400"}`}>
              {result.success} {translate("added")}{result.failed ? `, ${result.failed} ${translate("failed")}` : ""}
            </p>
            {failedItems.length > 0 && (
              <ul className="rounded border border-accent/20 bg-sidebar/50 p-2 text-xs font-mono max-h-40 overflow-y-auto">
                {failedItems.map((item) => (
                  <li key={item.index} className="text-red-400">[{item.index}] {item.error}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={submitting || !jsonText.trim()}>
            {submitting ? translate("Importing...") : translate("Import All")}
          </Button>
          <Button onClick={handleClose} variant="ghost" fullWidth disabled={submitting}>
            {translate("Close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
