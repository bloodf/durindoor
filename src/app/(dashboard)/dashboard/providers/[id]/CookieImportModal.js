"use client";

import { useMemo, useState } from "react";
import Modal from "@/shared/ui/components/Modal.jsx";
import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";
import { V5NativeSelect } from "@/shared/ui/v5/NativeSelect.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Textarea from "@/shared/ui/components/Textarea.jsx";
import { normalizeAccountEmail, resolveCookieImportContract, contractUsesCookies, displayCookieNames } from "@/shared/utils/cookieImportContract";
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
 * V5 masks pasted credentials while retaining the same import payload.
 * The pasted text, the parsed cookies and the pairing secret are dropped from
 * the page as soon as the operator submits or dismisses the dialog.
 */
export default function CookieImportModal({ isOpen, provider, providerName, importContract, webLogin, connections = [], onSuccess, onClose }) {
  const v5 = useUiV5();
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
  const [storageValues, setStorageValues] = useState({});
  const [accountEmail, setAccountEmail] = useState("");

  const contract = useMemo(() => importContract ?? resolveCookieImportContract(webLogin), [importContract, webLogin]);
  const ambiguous = candidatesAreAmbiguous(candidates);
  const selected = selectedIndex >= 0 ? candidates[selectedIndex] : null;
  // A provider whose credential is a localStorage item (TinyCMS) takes pasted values, not cookies.
  const storageKeys = contract?.localStorageKeys ?? [];
  const usesCookies = contractUsesCookies(contract);
  const credentialPattern = useMemo(() => {
    try { return contract?.credentialPattern ? new RegExp(contract.credentialPattern) : null; } catch { return null; }
  }, [contract]);
  const storageReady = storageKeys.every((key) => {
    const value = (storageValues[key] || "").trim();
    return Boolean(value) && (!credentialPattern || credentialPattern.test(value));
  });
  // Inner.ai Web: an optional account email the server binds to the pairing. Blank means token only.
  const takesAccountEmail = contract?.accountEmail === "optional";
  const emailCheck = takesAccountEmail ? normalizeAccountEmail(accountEmail) : { ok: true, email: "" };
  const cookieConnections = usesCookies ? connections.filter((connection) => connection?.authType === "cookie") : connections;

  const clearSensitiveInput = () => {
    setRawText("");
    setFileLabel("");
    setCandidates([]);
    setSelectedIndex(-1);
    setStorageValues({});
    setAccountEmail("");
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

  const pairingTarget = () => ({
    ...(targetMode === "create"
      ? { provider, action: "create", name: name.trim() }
      : { provider, action: "update", connectionId }),
    // Only a non-blank email is sent; the server validates it again and never echoes it.
    ...(takesAccountEmail && emailCheck.email ? { accountEmail: emailCheck.email } : null),
  });

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
    if (!contract || busy || (usesCookies && !selected) || !storageReady || !emailCheck.ok) return;
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
          origin: usesCookies ? selected.origin : contract.origin,
          ...(usesCookies ? { cookies: selected.cookies } : null),
          ...(storageKeys.length ? { localStorage: Object.fromEntries(storageKeys.map((key) => [key, storageValues[key].trim()])) } : null),
          ...(targetMode === "create" ? { name: name.trim() } : { connectionId }),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The import failed.");
      const imported = usesCookies
        ? `${selected.cookies.length} cookie${selected.cookies.length === 1 ? "" : "s"}`
        : `${storageKeys.length} session value${storageKeys.length === 1 ? "" : "s"}`;
      clearSensitiveInput();
      setStatus(`Imported ${imported} into ${data.connection?.name || "the connection"}.`);
      onSuccess?.(data.connection);
    } catch (failure) {
      clearSensitiveInput();
      setError(failure.message || "The import failed.");
    } finally {
      setBusy(false);
    }
  };

  const createExtensionPairing = async () => {
    if (busy || !emailCheck.ok) return;
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
    setAccountEmail("");
    onClose();
  };

  if (!contract) return null;

  const targetReady = (targetMode === "create" ? Boolean(name.trim()) : Boolean(connectionId)) && emailCheck.ok;
  const canImport = (!usesCookies || Boolean(selected)) && storageReady && targetReady && !busy;
  const sources = usesCookies
    ? [["paste", "Paste header or cURL"], ["file", "HAR file"], ["extension", "Browser extension"]]
    : [["paste", "Paste value"], ["extension", "Browser extension"]];

  return (
    <Modal surfaceClassName={v5 ? "max-[480px]:max-h-[calc(100dvh-2rem)] max-[480px]:w-full max-[480px]:max-w-none" : ""} open={isOpen} title={`Import ${providerName || provider} ${usesCookies ? "cookies" : "session"}`} size="lg" onClose={dismiss} pending={busy}
      footer={<>
        <Button variant="ghost" onClick={dismiss} disabled={busy}>Cancel</Button>
        {mode === "extension" ?
          <Button variant="primary" onClick={createExtensionPairing} loading={busy} disabled={!targetReady || busy}>
            {pairing ? "New pairing" : "Create pairing"}
          </Button> :
          <Button variant="primary" onClick={importSelected} loading={busy} disabled={!canImport}>
            {usesCookies ? "Import cookies" : "Import session"}
          </Button>}
      </>}>
      <div className="flex flex-col gap-4">
        {usesCookies ?
          <p className="text-sm text-dd-muted">
            Import a signed-in {providerName || provider} session from a Cookie header, a cURL command or a HAR file. The input is read in this
            page as data: nothing is executed, no request is made to the URL it names and the HAR file is not uploaded.
          </p> :
          <p className="text-sm text-dd-muted">
            {providerName || provider} keeps its session in the browser&apos;s local storage on {contract.origin}, not in a cookie. Paste the
            value below, or let the browser extension read it from a signed-in tab.
          </p>}

        <div className="flex flex-wrap gap-2" role="group" aria-label="Import source">
          {sources.map(([value, label]) => (
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
              {usesCookies ? "Replace cookies" : "Replace session"}
            </Button>
          </div>
          {targetMode === "create" ?
            <Input label="Connection name" value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /> :
            <label className="flex flex-col gap-1 text-xs text-dd-muted">
              Connection
              {v5 ? <V5NativeSelect aria-label="Connection" value={connectionId} onChange={(event) => setConnectionId(event.target.value)} disabled={busy}>
                <option value="">Choose a connection…</option>
                {cookieConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name || connection.id}</option>)}
              </V5NativeSelect> : <select
                className="min-h-11 rounded-dd border border-dd-border bg-dd-surface px-3 py-2 text-sm text-dd-text"
                value={connectionId}
                onChange={(event) => setConnectionId(event.target.value)}
                disabled={busy}>
                <option value="">Choose a connection…</option>
                {cookieConnections.map((connection) => (
                  <option key={connection.id} value={connection.id}>{connection.name || connection.id}</option>
                ))}
              </select>}
            </label>}
          {takesAccountEmail ?
            <>
              <Input
                label="Account email (optional)"
                type="email"
                autoComplete="off"
                spellCheck={false}
                placeholder="user@example.com"
                value={accountEmail}
                onChange={(event) => { setAccountEmail(event.target.value); setPairing(null); }}
                disabled={busy} />
              <p className="text-xs text-dd-muted">
                The email you sign in to {providerName || provider} with, stored after the token. DurinDoor first asks the provider profile for
                the account email and uses this one only when that lookup returns none. Leave it blank to store the token alone and rely on the
                profile lookup. Replacing a connection with a blank email also removes any email saved before. The browser extension never reads
                an email: enter it here before you create the pairing.
              </p>
              {!emailCheck.ok ? <p className="text-xs text-dd-danger">Enter a single email address, or leave the field blank.</p> : null}
            </> : null}
        </section>

        {mode === "paste" && storageKeys.length > 0 &&
          <section className="flex flex-col gap-2">
            {storageKeys.map((key) => (
              <Input
                key={key}
                label={`localStorage ${key}`}
                type={v5 ? "password" : "text"}
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                value={storageValues[key] || ""}
                onChange={(event) => setStorageValues((current) => ({ ...current, [key]: event.target.value }))}
                disabled={busy} />
            ))}
            {storageKeys.some((key) => (storageValues[key] || "").trim()) && !storageReady ?
              <p className="text-xs text-dd-danger">The value does not have the format this provider uses.</p> : null}
          </section>}

        {mode === "paste" && usesCookies &&
          <section className="flex flex-col gap-2">
            <Textarea
              label="Cookie header or cURL command"
              style={v5 ? (globalThis.CSS?.supports?.("-webkit-text-security", "disc") ? { WebkitTextSecurity: "disc" } : { color: "transparent", caretColor: "var(--dd-text)" }) : undefined}
              className={v5 ? "min-h-[140px] font-mono selection:text-transparent" : "min-h-[140px] font-mono"}
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
                <code className="break-all font-mono">{displayCookieNames(pairing.contract).join(", ") || "none"}</code>
                {pairing.contract?.localStorageKeys?.length ? <>
                  <p className="text-dd-muted">localStorage items</p>
                  <code className="break-all font-mono">{pairing.contract.localStorageKeys.join(", ")}</code>
                </> : null}
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
