"use client";

import { useState, useEffect } from "react";
import { Card } from "@/shared/ui/components/Card.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import { getProviderAlias } from "@/shared/constants/providers";
import { getModelKind } from "@/shared/constants/models";
import { getModelsByProviderId } from "@/shared/constants/models";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { Row } from "./exampleShared";
import { isString } from "../../../../../../../shared/utils/typeChecks.js";

export function SttExampleCard({ providerId }) {
  const providerAlias = getProviderAlias(providerId);
  const builtinSttModels = getModelsByProviderId(providerId).filter((m) => getModelKind(m) === "stt");
  const [customSttModels, setCustomSttModels] = useState([]);
  const sttModels = [...builtinSttModels, ...customSttModels];

  const [selectedModel, setSelectedModel] = useState(builtinSttModels[0]?.id ?? "");
  const selectedModelObj = sttModels.find((m) => m.id === selectedModel);
  const allowedParams = Array.isArray(selectedModelObj?.params) ? selectedModelObj.params : [];

  const [audioFile, setAudioFile] = useState(null);
  const [language, setLanguage] = useState("");
  const [prompt, setPrompt] = useState("");
  const [responseFormat, setResponseFormat] = useState("json");
  const [temperature, setTemperature] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [useTunnel, setUseTunnel] = useState(false);
  const [localEndpoint, setLocalEndpoint] = useState("");
  const [tunnelEndpoint, setTunnelEndpoint] = useState("");
  const [result, setResult] = useState(null);
  const [latency, setLatency] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const { copied: copiedCurl, copy: copyCurl } = useCopyToClipboard();
  const { copied: copiedRes, copy: copyRes } = useCopyToClipboard();

  useEffect(() => {
    setLocalEndpoint(window.location.origin);
    fetch("/api/tunnel/status").
    then((r) => r.json()).
    then((d) => {if (d.publicUrl) setTunnelEndpoint(d.publicUrl);}).
    catch(() => {});
    const loadCustom = () => {
      fetch("/api/models/custom", { cache: "no-store" }).
      then((r) => r.json()).
      then((d) => {
        const list = (d.models || []).filter((m) => getModelKind(m) === "stt" && m.providerAlias === providerAlias);
        setCustomSttModels(list);
      }).
      catch(() => {});
    };
    loadCustom();
    window.addEventListener("focus", loadCustom);
    window.addEventListener("customModelChanged", loadCustom);
    return () => {
      window.removeEventListener("focus", loadCustom);
      window.removeEventListener("customModelChanged", loadCustom);
    };
  }, [providerAlias]);

  const endpoint = useTunnel ? tunnelEndpoint : localEndpoint;
  const modelFull = selectedModel ? `${providerAlias}/${selectedModel}` : "";

  const curlSnippet = `curl -X POST ${endpoint}/v1/audio/transcriptions \\
  -H "Authorization: Bearer ${apiKey || "YOUR_KEY"}" \\
  -F "file=@${audioFile?.name || "audio.mp3"}" \\
  -F "model=${modelFull}"${allowedParams.includes("language") && language ? ` \\\n  -F "language=${language}"` : ""}${allowedParams.includes("response_format") ? ` \\\n  -F "response_format=${responseFormat}"` : ""}${allowedParams.includes("temperature") && temperature ? ` \\\n  -F "temperature=${temperature}"` : ""}${allowedParams.includes("prompt") && prompt ? ` \\\n  -F "prompt=${prompt}"` : ""}`;

  const handleRun = async () => {
    if (!audioFile || !modelFull) return;
    setRunning(true);
    setError("");
    setResult(null);
    const start = Date.now();
    try {
      const fd = new FormData();
      fd.append("file", audioFile);
      fd.append("model", modelFull);
      if (allowedParams.includes("language") && language) fd.append("language", language);
      if (allowedParams.includes("response_format")) fd.append("response_format", responseFormat);
      if (allowedParams.includes("temperature") && temperature) fd.append("temperature", temperature);
      if (allowedParams.includes("prompt") && prompt) fd.append("prompt", prompt);

      const headers = {};
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch("/api/v1/audio/transcriptions", { method: "POST", headers, body: fd });
      setLatency(Date.now() - start);
      const ct = res.headers.get("content-type") || "";
      const data = ct.includes("application/json") ? await res.json() : await res.text();
      if (!res.ok) {
        setError(data?.error?.message || data?.error || data || `HTTP ${res.status}`);
        return;
      }
      setResult(data);
    } catch (e) {
      setError(e.message || "Network error");
    } finally {
      setRunning(false);
    }
  };

  const resultStr = isString(result) ? result : result ? JSON.stringify(result, null, 2) : `{\n  "text": "Hello world..."\n}`;

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold text-dd-text">Example</h2>
      <div className="flex flex-col gap-3">
        <Row label="Model">
          {sttModels.length > 0 ? <Select aria-label="Model" value={selectedModel} onChange={setSelectedModel} options={sttModels.map((m) => ({ value: m.id, label: m.name || m.id }))} /> : <Input aria-label="Model" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} placeholder="Enter model id" className="font-mono" />}
        </Row>
        <Row label="Endpoint">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input aria-label="Transcription endpoint URL" value={`${endpoint}/v1/audio/transcriptions`} readOnly className="flex-1 font-mono" />
            {tunnelEndpoint && <Button size="sm" variant={useTunnel ? "primary" : "secondary"} icon="wifi_tethering" aria-label={useTunnel ? "Use local endpoint" : "Use tunnel endpoint"} onClick={() => setUseTunnel((value) => !value)}>{useTunnel ? "Tunnel" : "Local"}</Button>}
          </div>
        </Row>
        <Row label="API Key"><Input aria-label="API key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" placeholder="Paste a saved API key secret" className="font-mono" /></Row>
        <Row label="Audio File">
          <div className="flex flex-col gap-2">
            <label className="relative flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-dd border border-dd-border bg-dd-surface px-3 py-2 text-[13px] text-dd-text outline-none transition-colors hover:border-dd-border-subtle focus-within:border-dd-accent focus-within:shadow-dd-focus">
              <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-dd-muted">upload_file</span>
              <span>{audioFile ? "Replace file" : "Choose audio file"}</span>
              <input type="file" aria-label="Audio file" accept="audio/*,video/mp4,.m4a,.mp3,.wav,.ogg,.flac,.webm,.opus" onChange={(e) => setAudioFile(e.target.files?.[0] || null)} className="absolute -inset-px cursor-pointer opacity-0" />
            </label>
            {audioFile && <span className="font-mono text-xs text-dd-muted">{audioFile.name} · {(audioFile.size / 1024).toFixed(1)} KB</span>}
          </div>
        </Row>
        {allowedParams.includes("language") && <Row label="Language"><Input aria-label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="e.g. en, vi, ja (auto-detect if empty)" className="font-mono" /></Row>}
        {allowedParams.includes("prompt") && <Row label="Prompt"><Input aria-label="Prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="optional context to improve accuracy" /></Row>}
        {allowedParams.includes("temperature") && <Row label="Temperature"><Input aria-label="Temperature" type="number" step="0.1" min="0" max="1" value={temperature} onChange={(e) => setTemperature(e.target.value)} placeholder="0 - 1 (default 0)" /></Row>}
        {allowedParams.includes("response_format") && (
          <Row label="Response Format">
            <Select aria-label="Response format" value={responseFormat} onChange={setResponseFormat} options={[{ value: "json", label: "json" }, { value: "text", label: "text" }, { value: "srt", label: "srt" }, { value: "verbose_json", label: "verbose_json" }, { value: "vtt", label: "vtt" }]} />
          </Row>
        )}
        <div className="mt-1">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-semibold uppercase tracking-wider text-dd-muted">Request</span><div className="flex gap-2"><Button size="sm" variant="ghost" icon={copiedCurl ? "check" : "content_copy"} onClick={() => copyCurl(curlSnippet)}>{copiedCurl ? "Copied" : "Copy"}</Button><Button size="sm" variant="primary" icon="play_arrow" loading={running} onClick={handleRun} disabled={!audioFile || !modelFull}>{running ? "Transcribing..." : "Run"}</Button></div></div>
          <pre tabIndex={0} aria-label="Request example" className="overflow-x-auto whitespace-pre-wrap break-all rounded-dd bg-dd-surface-2 p-3 text-xs text-dd-text" role="region">{curlSnippet}</pre>
        </div>
        {error && <p role="alert" className="break-words text-xs text-dd-danger">{error}</p>}
        <div><div className="mb-1.5 flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-semibold uppercase tracking-wider text-dd-muted">Response {result && latency && <span className="font-normal normal-case">⚡ {latency}ms</span>}</span>{result && <Button size="sm" variant="ghost" icon={copiedRes ? "check" : "content_copy"} onClick={() => copyRes(resultStr)}>{copiedRes ? "Copied" : "Copy"}</Button>}</div><pre tabIndex={0} aria-label="Response output" className="overflow-x-auto whitespace-pre-wrap break-all rounded-dd bg-dd-surface-2 p-3 text-xs text-dd-text" role="region">{resultStr}</pre></div>
      </div>
    </Card>
  );
}