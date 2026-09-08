"use client";

import { useState, useEffect } from "react";
import { Card } from "@/shared/ui/components/Card.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import { getProviderAlias, isCustomEmbeddingProvider } from "@/shared/constants/providers";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { Row } from "./exampleShared";

const DEFAULT_RESPONSE_EXAMPLE = `{
  "object": "list",
  "data": [{
    "object": "embedding",
    "index": 0,
    "embedding": [0.002301, -0.019212, 0.004815, -0.031249, ...]
  }],
  "model": "...",
  "usage": { "prompt_tokens": 9, "total_tokens": 9 }
}`;

export function EmbeddingExampleCard({ providerId, customAlias }) {
  const isCustom = isCustomEmbeddingProvider(providerId);
  const providerAlias = isCustom ? (customAlias || providerId) : getProviderAlias(providerId);
  const embeddingModels = isCustom ? [] : getModelsByProviderId(providerId).filter((m) => getModelKind(m) === "embedding");

  const [selectedModel, setSelectedModel] = useState(embeddingModels[0]?.id ?? "");
  const [input, setInput] = useState("The quick brown fox jumps over the lazy dog");
  const [dimensions, setDimensions] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [useTunnel, setUseTunnel] = useState(false);
  const [localEndpoint, setLocalEndpoint] = useState("");
  const [tunnelEndpoint, setTunnelEndpoint] = useState("");
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const { copied: copiedCurl, copy: copyCurl } = useCopyToClipboard();
  const { copied: copiedRes, copy: copyRes } = useCopyToClipboard();

  useEffect(() => {
    setLocalEndpoint(window.location.origin);
    fetch("/api/tunnel/status")
      .then((r) => r.json())
      .then((d) => { if (d.publicUrl) setTunnelEndpoint(d.publicUrl); })
      .catch(() => {});
  }, []);

  const endpoint = useTunnel ? tunnelEndpoint : localEndpoint;
  const modelFull = selectedModel ? `${providerAlias}/${selectedModel}` : "";

  // Build request body — include dimensions only if user provided a positive number
  const buildBody = () => {
    const body = { model: modelFull, input: input.trim() };
    const dim = Number(dimensions);
    if (dimensions && Number.isFinite(dim) && dim > 0) body.dimensions = dim;
    return body;
  };

  const curlSnippet = `curl -X POST ${endpoint}/v1/embeddings \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey || "YOUR_KEY"}" \\
  -d '${JSON.stringify(buildBody())}'`;

  const handleRun = async () => {
    if (!input.trim() || !modelFull) return;
    setRunning(true);
    setError("");
    setResult(null);
    const start = Date.now();
    try {
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch("/api/v1/embeddings", {
        method: "POST",
        headers,
        body: JSON.stringify(buildBody()),
      });
      const latencyMs = Date.now() - start;
      const data = await res.json();
      if (!res.ok) { setError(data?.error?.message || data?.error || `HTTP ${res.status}`); return; }
      setResult({ data, latencyMs });
    } catch (e) {
      setError(e.message || "Network error");
    } finally {
      setRunning(false);
    }
  };

  // Compact embedding array: first 4 values + count
  const formatResultJson = (data) => {
    if (!data) return DEFAULT_RESPONSE_EXAMPLE;
    const clone = JSON.parse(JSON.stringify(data));
    (clone.data || []).forEach((item) => {
      if (Array.isArray(item.embedding) && item.embedding.length > 4) {
        item.embedding = [...item.embedding.slice(0, 4).map((v) => parseFloat(v.toFixed(6))), `... (${item.embedding.length} dims)`];
      }
    });
    return JSON.stringify(clone, null, 2);
  };

  const resultJson = result ? JSON.stringify(result.data, null, 2) : "";

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold text-dd-text">Example</h2>
      <div className="flex flex-col gap-3">
        <Row label="Model">
          {isCustom ? <Input aria-label="Model" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} placeholder="e.g. voyage-3, embed-english-v3.0, text-embedding-3-small" className="font-mono" /> : <Select aria-label="Model" value={selectedModel} onChange={setSelectedModel} options={embeddingModels.map((m) => ({ value: m.id, label: m.name || m.id }))} />}
        </Row>
        <Row label="Endpoint">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="min-w-0 flex-1"><Input aria-label="Endpoint" value={endpoint} onChange={(e) => useTunnel ? setTunnelEndpoint(e.target.value) : setLocalEndpoint(e.target.value)} placeholder="http://localhost:3000" className="font-mono" /></div>
            {tunnelEndpoint && <Button size="sm" variant={useTunnel ? "primary" : "secondary"} icon="wifi_tethering" onClick={() => setUseTunnel((value) => !value)}>{useTunnel ? "Tunnel" : "Local"}</Button>}
          </div>
        </Row>
        <Row label="API Key"><Input aria-label="API Key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." autoComplete="off" className="font-mono" /></Row>
        <Row label="Input"><div className="relative"><Input aria-label="Input" value={input} onChange={(e) => setInput(e.target.value)} className="pe-12" />{input && <IconButton icon="close" label="Clear input" size="sm" onClick={() => setInput("")} className="absolute end-0 top-1/2 -translate-y-1/2" />}</div></Row>
        <Row label="Dimensions"><Input aria-label="Dimensions" type="number" min="1" value={dimensions} onChange={(e) => setDimensions(e.target.value)} placeholder="optional, e.g. 512" /></Row>
        <div className="mt-1">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-semibold uppercase tracking-wider text-dd-muted">Request</span><div className="flex gap-2"><Button size="sm" variant="ghost" icon={copiedCurl ? "check" : "content_copy"} onClick={() => copyCurl(curlSnippet)}>{copiedCurl ? "Copied" : "Copy"}</Button><Button size="sm" variant="primary" icon="play_arrow" loading={running} onClick={handleRun} disabled={!input.trim() || !modelFull}>Run</Button></div></div>
          <pre tabIndex={0} aria-label="Request example" className="overflow-x-auto whitespace-pre-wrap break-all rounded-dd bg-dd-surface-2 p-3 text-xs text-dd-text" role="region">{curlSnippet}</pre>
        </div>
        {error && <p role="alert" className="break-words text-xs text-dd-danger">{error}</p>}
        <div><div className="mb-1.5 flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-semibold uppercase tracking-wider text-dd-muted">Response {result && <span className="font-normal normal-case">⚡ {result.latencyMs}ms</span>}</span>{result && <Button size="sm" variant="ghost" icon={copiedRes ? "check" : "content_copy"} onClick={() => copyRes(resultJson)}>{copiedRes ? "Copied" : "Copy"}</Button>}</div><pre tabIndex={0} aria-label="Response output" className="overflow-x-auto whitespace-pre-wrap break-all rounded-dd bg-dd-surface-2 p-3 text-xs text-dd-text" role="region">{formatResultJson(result?.data)}</pre></div>
      </div>
    </Card>
  );
}
