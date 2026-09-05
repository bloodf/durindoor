"use client";

import { useRef, useState } from "react";
import Button from "@/shared/ui/components/Button";
import Checkbox from "@/shared/ui/components/Checkbox";
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog";
import PromptDialog from "@/shared/ui/components/PromptDialog";

const TRANSFER_URL = "/api/settings/database/selective";

function download(bundle) {
  const anchor = document.createElement("a");
  anchor.href = globalThis.URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
  anchor.download = `durindoor-selective-transfer-${new Date().toISOString().replace(/[.:]/g, "-")}.json`;
  anchor.click();
  globalThis.URL.revokeObjectURL(anchor.href);
}

function bundleIds(bundle) {
  return {
    providers: bundle.providerConnections.map((row) => row?.id).filter(Boolean),
    combos: bundle.combos.map((row) => row?.id).filter(Boolean),
  };
}

export default function SelectiveTransferPanel() {
  const [catalog, setCatalog] = useState(null);
  const [selection, setSelection] = useState({ providers: [], combos: [] });
  const [pending, setPending] = useState(null);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [confirmSecrets, setConfirmSecrets] = useState(false);
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState(null);
  const fileRef = useRef(null);
  const bundleRef = useRef(null);

  // `selectionOverride === null` omits the `selection` field entirely (bundle
  // import derives its own row IDs server-side); `undefined` sends the
  // operator's current catalog checkboxes.
  async function call(password, action, extra = {}, selectionOverride) {
    const payload = { action, password, ...extra };
    if (selectionOverride === null) {
      // omitted on purpose
    } else if (selectionOverride !== undefined) {
      payload.selection = selectionOverride;
    } else {
      payload.selection = selection;
    }
    const response = await fetch(TRANSFER_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Selective transfer failed");
    return data;
  }
  function toggle(kind, id, checked) {
    setPreview(null);
    setSelection((old) => ({ ...old, [kind]: checked ? [...old[kind], id] : old[kind].filter((value) => value !== id) }));
  }

  async function perform(password) {
    const job = pending;
    setPending(null);
    try {
      if (job.mode === "catalog") setCatalog(await call(password, "catalog"));
      if (job.mode === "preview") {
        const projection = await call(password, "preview", { includeSecrets: true });
        setPreview({
          providers: catalog.providers.filter((row) => selection.providers.includes(row.id)).map((row) => row.name),
          combos: catalog.combos.filter((row) => selection.combos.includes(row.id)).map((row) => row.name),
        });
        setStatus(`Preview: ${projection.providerConnections.length} providers, ${projection.combos.length} combos. Credentials excluded.`);
      }
      if (job.mode === "export") download(await call(password, "export", { includeSecrets, acknowledgeSecretExport: includeSecrets }));
      if (job.mode === "apply-preview") {
        const bundle = bundleRef.current;
        bundleRef.current = null;
        const preview = await call(password, "preview", { bundle }, bundleIds(bundle));
        setPending({ mode: "apply-confirm", bundle, preview });
        return;
      }
      if (job.mode === "apply") {
        await call(password, "apply", { bundle: job.bundle }, null);
        setStatus("Selected provider and combo rows imported.");
      }
    } catch (error) {
      bundleRef.current = null;
      setStatus(error.message);
    }
  }

  async function selectFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      bundleRef.current = JSON.parse(await file.text());
      setPending({ mode: "apply-preview" });
    } catch {
      setStatus("Choose a valid selective transfer JSON file.");
    }
  }

  function exportSelected() {
    if (includeSecrets) setConfirmSecrets(true);
    else setPending({ mode: "export" });
  }

  return (
    <section className="mt-4 rounded-dd-lg border border-dd-border bg-dd-surface p-4">
      <div className="flex flex-col gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-dd-text">Selective transfer</h3>
          <p className="text-xs text-dd-muted">Export or import only selected providers and combos. Previews never include credentials.</p>
        </div>
        {!catalog ? (
          <Button size="sm" onClick={() => setPending({ mode: "catalog" })}>Load transfer catalog</Button>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {[["providers", "Providers"], ["combos", "Combos"]].map(([kind, title]) => (
                <div key={kind} className="rounded-dd border border-dd-border bg-dd-surface-2 p-3">
                  <p className="mb-2 text-xs font-medium text-dd-muted">{title}</p>
                  {catalog[kind].map((row) => (
                    <Checkbox key={row.id} checked={selection[kind].includes(row.id)} onChange={(checked) => toggle(kind, row.id, checked)} label={row.name} />
                  ))}
                </div>
              ))}
            </div>
            <Checkbox checked={includeSecrets} onChange={setIncludeSecrets} label="Include credentials" hint="Off by default. Export needs separate confirmation." />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPending({ mode: "preview" })}>Preview</Button>
              <Button size="sm" onClick={exportSelected}>Export selected</Button>
              <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>Import selected bundle</Button>
              <input ref={fileRef} className="hidden" type="file" accept="application/json,.json" onChange={selectFile} />
            </div>
            {preview ? (
              <div className="rounded-dd border border-dd-border bg-dd-surface-2 p-3 text-xs text-dd-muted">
                <p className="font-medium text-dd-text">Export preview</p>
                <p>Providers: {preview.providers.join(", ") || "None"}</p>
                <p>Combos: {preview.combos.join(", ") || "None"}</p>
                <p>Credentials excluded.</p>
              </div>
            ) : null}
          </>
        )}
        {status ? <p role="status" className="text-xs text-dd-muted">{status}</p> : null}
      </div>
      <PromptDialog
        inputType="password"
        open={Boolean(pending) && pending.mode !== "apply-confirm"}
        title="Confirm dashboard password"
        label="Current password"
        placeholder="Password"
        submitLabel="Continue"
        onSubmit={perform}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={confirmSecrets}
        title="Export credentials?"
        message="This export will contain provider credentials. Share only through a secure channel."
        tone="danger"
        confirmLabel="Include credentials"
        onCancel={() => setConfirmSecrets(false)}
        onConfirm={() => {
          setConfirmSecrets(false);
          setPending({ mode: "export" });
        }}
      />
      <ConfirmDialog
        open={pending?.mode === "apply-confirm"}
        title="Apply selected transfer?"
        message={`Import preview: ${pending?.preview?.providerConnections?.map((row) => `${row.currentName || row.id} (${row.action})`).join(", ") || "no providers"}; ${pending?.preview?.combos?.map((row) => `${row.finalName || row.currentName || row.id} (${row.action})`).join(", ") || "no combos"}. Credentials are never shown in preview.`}
        tone="primary"
        confirmLabel="Apply transfer"
        onCancel={() => setPending(null)}
        onConfirm={() => setPending({ mode: "apply", bundle: pending.bundle })}
      />
    </section>
  );
}
