"use client";

import { useEffect, useState } from "react";

/** Experimental ordinary-browser configuration; all locators are supplied by the operator. */
export default function FireflyBrowserPanel() {
  const [connections, setConnections] = useState([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("Adobe Firefly browser");
  const [enabled, setEnabled] = useState(false);
  const [mapping, setMapping] = useState("{}");
  const [models, setModels] = useState("{}");
  const [attested, setAttested] = useState(false);
  const [message, setMessage] = useState("Live sign-in and entitlement are unknown.");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/providers", { cache: "no-store" });
    if (!response.ok) throw new Error("Unable to load connections");
    const data = await response.json();
    setConnections((data.connections || []).filter((row) => row.provider === "adobe-firefly-web"));
  }
  useEffect(() => { let active = true; fetch("/api/providers", { cache: "no-store" }).then(async (response) => {
    if (!response.ok) throw new Error("Unable to load connections");
    const data = await response.json();
    if (active) setConnections((data.connections || []).filter((row) => row.provider === "adobe-firefly-web"));
  }).catch((error) => { if (active) setMessage(error.message); }); return () => { active = false; }; }, []);

  function choose(id) {
    setSelected(id);
    const row = connections.find((entry) => entry.id === id);
    const config = row?.providerSpecificData?.fireflyWebUi || {};
    setName(row?.name || "Adobe Firefly browser");
    setEnabled(config.enabled === true);
    setMapping(JSON.stringify(config.mapping || {}, null, 2));
    setModels(JSON.stringify(config.modelMap || {}, null, 2));
    setAttested(false);
    setMessage("Live sign-in and entitlement are unknown.");
  }

  async function save(event) {
    event.preventDefault(); setBusy(true);
    try {
      const parsedMapping = JSON.parse(mapping);
      const modelMap = JSON.parse(models);
      const hasMapping = Object.keys(parsedMapping).length > 0 || Object.keys(modelMap).length > 0;
      if (hasMapping && !attested) throw new Error("Attest your control mapping before saving");
      const fireflyWebUi = { enabled, ...(hasMapping ? { mapping: { ...parsedMapping, validatedBy: "operator", validatedAt: new Date().toISOString() }, modelMap } : null) };
      const response = await fetch(selected ? `/api/providers/${selected}` : "/api/providers", { method: selected ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "adobe-firefly-web", name, providerSpecificData: { fireflyWebUi } }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Save failed");
      setSelected(data.connection.id); await load(); setMessage("Saved. Live behavior remains unknown.");
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }

  async function setup(method) {
    setBusy(true);
    try {
      const response = await fetch(`/api/providers/${selected}/firefly-setup`, { method });
      const data = await response.json();
      setMessage(response.ok ? `${data.outcome}: ${data.note || (data.open ? "Browser is open for operator action" : "No setup browser is open; sign-in is unknown")}` : data.error);
    } catch { setMessage("Setup status unknown"); } finally { setBusy(false); }
  }

  return <section className="flex flex-col gap-4 p-6">
    <h1>Adobe Firefly experimental browser</h1>
    <p>Operator-mapped; tested with mocks only. No live compatibility or entitlement claim. Firefly Services API requires a separate developer entitlement.</p>
    <p>The browser opens on the DurinDoor host and requires a display. Sign in and resolve challenges yourself. No remote browser or stealth fallback. No cookies, tokens or storage are imported or exported.</p>
    <label>Connection<select value={selected} onChange={(event) => choose(event.target.value)}><option value="">New private profile</option>{connections.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
    <form onSubmit={save} className="flex flex-col gap-4">
      <label>Name<input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} /></label>
      <label><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />Explicitly enable this connection</label>
      <label>Model map JSON: public ID to label and image/video kind<textarea value={models} maxLength={30000} rows={8} onChange={(event) => { setModels(event.target.value); setAttested(false); }} /></label>
      <label>Control mapping JSON: role/name or label only<textarea value={mapping} maxLength={30000} rows={12} onChange={(event) => { setMapping(event.target.value); setAttested(false); }} /></label>
      <p>No Adobe selectors are supplied. Map prompt, modelPicker, modelOptionRole, submit, resultItem, resultReady, download and stopMarkers; optionally identityAttr and startPaths. Models and locators are bounded and checked by the server.</p>
      <label><input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} />I validated these controls against my current UI. This attestation is mine; DurinDoor has not verified Adobe.</label>
      <button disabled={busy} type="submit">Save browser configuration</button>
    </form>
    <div><button disabled={busy || !selected} onClick={() => setup("POST")}>Open host setup browser</button><button disabled={busy || !selected} onClick={() => setup("GET")}>Check setup status</button><button disabled={busy || !selected} onClick={() => setup("DELETE")}>Close setup browser</button></div>
    <p role="status">{message}</p>
  </section>;
}
