"use client";

import { useMemo, useState } from "react";
import Modal from "@/shared/ui/components/Modal.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Textarea from "@/shared/ui/components/Textarea.jsx";
import { resolveCookieImportContract } from "@/shared/utils/cookieImportContract";
import { isFunction } from "@/shared/utils/typeChecks";
import {
  MAX_HAR_FILE_BYTES,
  MAX_IMPORT_TEXT_LENGTH,
  parseCookieHeaderValue,
  parseCurlCommand,
  parseHarDocument,
  buildImportCandidates,
  candidatesAreAmbiguous,
} from "@/shared/utils/cookieImportParser";

const PAIRING_URL = "/api/providers/cookie-import/pairing";
const IMPORT_URL = "/api/providers/cookie-import";

/**
 * Read a local file as text. The file never leaves the browser: it is parsed
 * here and only the approved cookie names and values are sent to the import
 * API.
 */
async function readFileText(file) {
  if (isFunction(file.text)) return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsText(file);
  });
}

/**
 * Dashboard import for a cookie provider.
 *
 * The operator can paste a raw Cookie header, paste a cURL command, pick a
 * local HAR file, or hand the browser extension a one-use pairing. Every input
 * is read as data in the browser: nothing is executed, no request is sent to
 * the URL in the input and the HAR file is never uploaded. The parsed cookies
 * go through the same import API the extension uses, so the provider's origin
 * and cookie allowlist are enforced by the server as well.
 *
 * The pasted text, the parsed cookies and the pairing secret are dropped from
 * the page as soon as the operator submits or dismisses the dialog.
 */
export default function CookieImportModal({ isOpen, provider, providerName, importContract, webLogin, connections = [], onSuccess, onClose }) {
  const [mode, setMode] = useState("paste");
  const [rawText, setRawText] = useState("");
  const [fileLabel, setFileLabel] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [targetMode, setTargetMode] = useState("create");
  const [name, setName] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [pairing, setPairing] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const contract = useMemo(() => importContract ?? resolveCookieImportContract(webLogin), [importContract, webLogin]);
  const ambiguous = candidatesAreAmbiguous(candidates);
  const selected = selectedIndex >= 0 ? candidates[selectedIndex] : null;
  const cookieConnections = connections.filter((connection) => connection?.authType === "cookie");

  const clearSensitiveInput = () => {
    setRawText("");
    setFileLabel("");
    setCandidates([]);
    setSelectedIndex(-1);
  };

  const applyParsed = (parsed, kind) => {
    if (!parsed.ok) {
      setCandidates([]);
      setSelectedIndex(-1);
      setError(parsed.error);
      return;
    }
    const built = buildImportCandidates({ kind, parsed }, contract);
    if (!built.ok) {
      setCandidates([]);
      setSelectedIndex(-1);
      setError(built.error);
      return;
    }
    setError("");
    setCandidates(built.candidates);
    // Requests that all carry the same credentials are not ambiguous; a single
    // candidate is picked right away. Different credentials need a choice.
    const needsChoice = built.candidates.length > 1 && candidatesAreAmbiguous(built.candidates);
    setSelectedIndex(needsChoice ? -1 : 0);
  };

  /** Switching source drops the previous reading, so nothing stale is offered for import. */
  const switchMode = (next) => {
    setMode(next);
    setError("");
    setStatus("");
    setPairing(null);
    setCandidates([]);
    setSelectedIndex(-1);
  };

  const reviewPaste = () => {
    setError("");
    setStatus("");
    setPairing(null);
    const text = rawText.trim();
    if (!text) {
      setError("Nothing to read.");
      return;
    }
    if (text.length > MAX_IMPORT_TEXT_LENGTH) {
      setError("The pasted text is too large.");
      return;
    }
    if (/^curl(\.exe)?\b/i.test(text)) {
      applyParsed(parseCurlCommand(text), "curl");
      return;
    }
    if (text.startsWith("{")) {
      applyParsed(parseHarDocument(text), "har");
      return;
    }
    applyParsed(parseCookieHeaderValue(text), "header");
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setStatus("");
    setPairing(null);
    setCandidates([]);
    setSelectedIndex(-1);
    if (file.size > MAX_HAR_FILE_BYTES) {
      setError("The HAR file is too large.");
      return;
    }
    let text = "";
    try {
      text = await readFileText(file);
    } catch {
      setError("The HAR file could not be read.");
      return;
    }
    setFileLabel(file.name);
    applyParsed(parseHarDocument(text), "har");
  };

  const pairingTarget = () => (targetMode === "create"
    ? { provider, action: "create", name: name.trim() }
    : { provider, action: "update", connectionId });

  const mintPairing = async () => {
    const response = await fetch(PAIRING_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pairingTarget()),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "The pairing could not be created.");
    return data.pairing;
  };

  const importSelected = async () => {
    if (!selected || !contract || busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const created = await mintPairing();
      const response = await fetch(IMPORT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", [created.header]: created.token },
        body: JSON.stringify({
          provider,
          origin: selected.origin,
          cookies: selected.cookies,
          ...(targetMode === "create" ? { name: name.trim() } : { connectionId }),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The import failed.");
      clearSensitiveInput();
      setStatus(`Imported ${selected.cookies.length} cookie${selected.cookies.length === 1 ? "" : "s"} into ${data.connection?.name || "the connection"}.`);
      onSuccess?.(data.connection);
    } catch (failure) {
      clearSensitiveInput();
      setError(failure.message || "The import failed.");
    } finally {
      setBusy(false);
    }
  };

  const createExtensionPairing = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      setPairing(await mintPairing());
    } catch (failure) {
      setError(failure.message || "The pairing could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    clearSensitiveInput();
    setPairing(null);
    setError("");
    setStatus("");
    onClose();
  };

  if (!contract) return null;

  const targetReady = targetMode === "create" ? Boolean(name.trim()) : Boolean(connectionId);
  const canImport = Boolean(selected) && targetReady && !busy;

  return (
    <Modal open={isOpen} title={`Import ${providerName || provider} cookies`} size="lg" onClose={dismiss} pending={busy}
      footer={<>
        <Button variant="ghost" onClick={dismiss} disabled={busy}>Cancel</Button>
        {mode === "extension" ?
          <Button variant="primary" onClick={createExtensionPairing} loading={busy} disabled={!targetReady || busy}>
            {pairing ? "New pairing" : "Create pairing"}
          </Button> :
          <Button variant="primary" onClick={importSelected} loading={busy} disabled={!canImport}>
            Import cookies
          </Button>}
      </>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-dd-muted">
          Import a signed-in {providerName || provider} session from a Cookie header, a cURL command or a HAR file. The input is read in this
          page as data: nothing is executed, no request is made to the URL it names and the HAR file is not uploaded.
        </p>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Import source">
          {[["paste", "Paste header or cURL"], ["file", "HAR file"], ["extension", "Browser extension"]].map(([value, label]) => (
            <Button key={value} size="sm" variant={mode === value ? "primary" : "ghost"} onClick={() => switchMode(value)}>
              {label}
            </Button>
          ))}
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Target</h3>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={targetMode === "create" ? "primary" : "ghost"} onClick={() => setTargetMode("create")}>New connection</Button>
            <Button size="sm" variant={targetMode === "update" ? "primary" : "ghost"} onClick={() => setTargetMode("update")} disabled={!cookieConnections.length}>
              Replace cookies
            </Button>
          </div>
          {targetMode === "create" ?
            <Input label="Connection name" value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /> :
            <label className="flex flex-col gap-1 text-xs text-dd-muted">
              Connection
              <select
                className="min-h-11 rounded-dd border border-dd-border bg-dd-surface px-3 py-2 text-sm text-dd-text"
                value={connectionId}
                onChange={(event) => setConnectionId(event.target.value)}
                disabled={busy}>
                <option value="">Choose a connection…</option>
                {cookieConnections.map((connection) => (
                  <option key={connection.id} value={connection.id}>{connection.name || connection.id}</option>
                ))}
              </select>
            </label>}
        </section>

        {mode === "paste" &&
          <section className="flex flex-col gap-2">
            <Textarea
              label="Cookie header or cURL command"
              className="min-h-[140px] font-mono"
              placeholder="__Secure-next-auth.session-token=…"
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              disabled={busy} />
            <Button variant="secondary" className="self-start" onClick={reviewPaste} disabled={busy || !rawText.trim()}>Read input</Button>
          </section>}

        {mode === "file" &&
          <section className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-xs text-dd-muted">
              HAR file
              <input
                type="file"
                accept=".har,application/json"
                onChange={handleFile}
                disabled={busy}
                className="min-h-11 text-sm text-dd-text file:mr-3 file:rounded file:border-0 file:bg-dd-surface-2 file:px-3 file:py-2 file:text-sm" />
            </label>
            {fileLabel ? <p className="text-xs text-dd-muted">Read {fileLabel} in this page. It is not uploaded.</p> : null}
          </section>}

        {mode === "extension" &&
          <section className="flex flex-col gap-2">
            <p className="text-sm text-dd-muted">
              A browser extension sends the signed-in session itself. Create a one-use pairing and give it to the extension; the secret works
              once, for this provider and target only, and expires in two minutes.
            </p>
            {pairing ? (
              <div className="flex flex-col gap-2 rounded-dd border border-dd-border p-3 text-xs">
                <p className="text-dd-muted">Import URL</p>
                <code className="break-all font-mono">{pairing.importUrl}</code>
                <p className="text-dd-muted">Header</p>
                <code className="break-all font-mono">{pairing.header}</code>
                <p className="text-dd-muted">Secret</p>
                <code className="break-all font-mono">{pairing.token}</code>
                <p className="text-dd-muted">Origin</p>
                <code className="break-all font-mono">{pairing.contract?.origin}</code>
                <p className="text-dd-muted">Cookie names</p>
                <code className="break-all font-mono">{(pairing.contract?.cookieNames || []).join(", ")}</code>
                <p className="text-dd-muted">Expires at</p>
                <code className="break-all font-mono">{pairing.expiresAt}</code>
              </div>
            ) : null}
          </section>}

        {candidates.length > 0 &&
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Cookies found</h3>
            {ambiguous ?
              <p className="text-xs text-dd-muted">Several requests in the input carry different credentials. Choose the one to import.</p> : null}
            <ul className="flex flex-col gap-2">
              {candidates.map((candidate, index) => (
                <li key={`${candidate.url || "header"}-${index}`} className="rounded-dd border border-dd-border p-2 text-xs">
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="cookie-import-candidate"
                      className="mt-0.5"
                      checked={selectedIndex === index}
                      onChange={() => setSelectedIndex(index)}
                      disabled={busy} />
                    <span className="flex flex-col gap-1">
                      <span className="break-all font-mono">{candidate.url || `Cookie header for ${candidate.origin}`}</span>
                      <span className="text-dd-muted">
                        {candidate.cookies.map((cookie) => cookie.name).join(", ")}
                      </span>
                      {candidate.dropped?.length ? <span className="text-dd-muted">Ignored: {candidate.dropped.join(", ")}</span> : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {selected && !selected.originKnown ?
              <p className="text-xs text-dd-muted">A pasted header names no origin, so it is imported as {selected.origin}.</p> : null}
          </section>}

        {error ? <p role="alert" className="text-sm text-dd-danger">{error}</p> : null}
        {status ? <p role="status" className="text-sm text-dd-success">{status}</p> : null}
      </div>
    </Modal>
  );
}
