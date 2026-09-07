"use client";

import { useState, useEffect } from "react";
import { Card } from "@/shared/ui/components/Card.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import { MEDIA_PROVIDER_KINDS, getProviderAlias, resolveProviderId } from "@/shared/constants/providers";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { Row, KIND_EXAMPLE_CONFIG } from "./exampleShared";
import { isNumber, isObject, isString } from "../../../../../../../shared/utils/typeChecks.js";

const CLOUDFLARE_TEST_IMAGE_URL = "https://pub-1fb693cb11cc46b2b2f656f51e015a2c.r2.dev/dog.png";
const CLOUDFLARE_TEST_MASK_URL = "https://pub-1fb693cb11cc46b2b2f656f51e015a2c.r2.dev/dog-mask.png";

function getImageEditDefaults(providerId, modelId) {
  if (providerId !== "cloudflare-ai") return {};
  if (modelId === "@cf/runwayml/stable-diffusion-v1-5-img2img") {
    return { image: CLOUDFLARE_TEST_IMAGE_URL };
  }
  if (modelId === "@cf/runwayml/stable-diffusion-v1-5-inpainting") {
    return { image: CLOUDFLARE_TEST_IMAGE_URL, mask_image: CLOUDFLARE_TEST_MASK_URL };
  }
  return {};
}

function toImagePreviewSrc(value) {
  const trimmed = isString(value) ? value.trim() : "";
  if (!trimmed) return "";
  if (/^(data:image\/|https?:\/\/)/i.test(trimmed)) return trimmed;
  return `data:image/png;base64,${trimmed}`;
}

export function GenericExampleCard({ providerId, kind }) {
  const providerAlias = getProviderAlias(providerId);
  const resolvedId = resolveProviderId(providerAlias);
  const safeProviderAlias = resolvedId === providerId ? providerAlias : providerId;
  const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kind);
  const exConfig = KIND_EXAMPLE_CONFIG[kind];
  const safeExConfig = exConfig || {};

  // Get models for this kind (e.g., type="image")
  const kindModels = getModelsByProviderId(providerId).filter((m) => getModelKind(m) === kind);
  // Kinds that need a model identifier in the request (image/video/music)
  const KIND_NEEDS_MODEL = new Set(["image", "video", "music", "imageToText"]);
  const needsModel = KIND_NEEDS_MODEL.has(kind);
  const allowManualModel = needsModel && kindModels.length === 0;
  const [selectedModel, setSelectedModel] = useState(kindModels[0]?.id ?? "");
  const selectedModelObj = kindModels.find((m) => m.id === selectedModel);
  const supportsEdit = !!selectedModelObj?.capabilities?.includes("edit");
  const supportsMask = !!selectedModelObj?.capabilities?.includes("mask");

  const [input, setInput] = useState(safeExConfig.defaultInput || "");
  const [refImage, setRefImage] = useState("");
  const [maskImage, setMaskImage] = useState("");
  const [extraValues, setExtraValues] = useState(() =>
  (safeExConfig.extraFields || []).reduce((acc, f) => {acc[f.key] = f.default ?? "";return acc;}, {})
  );
  const [apiKey, setApiKey] = useState("");
  const [useTunnel, setUseTunnel] = useState(false);
  const [localEndpoint, setLocalEndpoint] = useState("");
  const [tunnelEndpoint, setTunnelEndpoint] = useState("");
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState(null); // { stage, bytesReceived }
  const [partialImage, setPartialImage] = useState(null);
  const [imageOutputFormat, setImageOutputFormat] = useState("json"); // json | binary
  const [binaryImageUrl, setBinaryImageUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [connections, setConnections] = useState([]);
  const [pinnedConnectionId, setPinnedConnectionId] = useState("");
  const { copied: copiedCurl, copy: copyCurl } = useCopyToClipboard();
  const { copied: copiedRes, copy: copyRes } = useCopyToClipboard();

  useEffect(() => {
    setLocalEndpoint(window.location.origin);
    fetch("/api/tunnel/status").
    then((r) => r.json()).
    then((d) => {if (d.publicUrl) setTunnelEndpoint(d.publicUrl);}).
    catch(() => {});
    // Load active connections of this provider for pinning
    fetch("/api/providers/client").
    then((r) => r.json()).
    then((d) => {
      const conns = (d.connections || []).filter((c) => c.provider === providerId && c.isActive !== false);
      setConnections(conns);
    }).
    catch(() => {});
  }, [providerId]);

  // Safe to early-return now that all hooks are declared
  if (!kindConfig || !exConfig) return null;

  const endpoint = useTunnel ? tunnelEndpoint : localEndpoint;
  const apiPath = providerId === "xai" && kind === "video" ?
  "/v1/videos/generations" :
  kindConfig.endpoint.path;
  // webSearch/webFetch: use safeProviderAlias only. Other kinds: append model when present.
  const modelFull = !needsModel ?
  safeProviderAlias :
  selectedModel ? `${safeProviderAlias}/${selectedModel}` : allowManualModel ? "" : safeProviderAlias;
  const imageEditDefaults = getImageEditDefaults(providerId, selectedModel);
  const effectiveRefImage = refImage.trim() || imageEditDefaults.image || "";
  const effectiveMaskImage = maskImage.trim() || imageEditDefaults.mask_image || "";
  const refImagePreviewSrc = toImagePreviewSrc(effectiveRefImage);
  const maskImagePreviewSrc = toImagePreviewSrc(effectiveMaskImage);

  // Build request body with optional extra fields (only non-empty values)
  const extraBodyFromFields = Object.entries(extraValues).reduce((acc, [k, v]) => {
    if (v === "" || v === null || v === undefined) return acc;
    if (isNumber(v) && Number.isNaN(v)) return acc;
    acc[k] = v;
    return acc;
  }, {});
  const requestBody = {
    model: modelFull,
    [exConfig.bodyKey]: input,
    ...exConfig.extraBody,
    ...extraBodyFromFields,
    ...(supportsEdit && effectiveRefImage ? { image: effectiveRefImage } : null),
    ...(supportsMask && effectiveMaskImage ? { mask_image: effectiveMaskImage } : null)
  };

  // Streaming supported for codex image (Plus/Pro accounts) — disabled when binary output requested
  const wantBinary = kind === "image" && imageOutputFormat === "binary";
  const useStreaming = kind === "image" && providerId === "codex" && !wantBinary;
  const apiPathWithQuery = `${apiPath}${wantBinary ? "?response_format=binary" : ""}`;
  const headersPreview = `-H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${apiKey || "YOUR_KEY"}"${pinnedConnectionId ? ` \\\n  -H "x-connection-id: ${pinnedConnectionId}"` : ""}${useStreaming ? ` \\\n  -H "Accept: text/event-stream"` : ""}`;
  const curlSnippet = `curl -X ${kindConfig.endpoint.method} ${endpoint}${apiPathWithQuery} \\
  ${headersPreview.replace(/\\\n  /g, "\\\n  ")} \\
  -d '${JSON.stringify(requestBody)}'${wantBinary ? " \\\n  --output image.png" : ""}`;

  const handleRun = async () => {
    if (!input.trim() || !modelFull) return;
    setRunning(true);
    setError("");
    setResult(null);
    setProgress(null);
    setPartialImage(null);
    if (binaryImageUrl) {try {URL.revokeObjectURL(binaryImageUrl);} catch {}setBinaryImageUrl("");}
    const start = Date.now();
    try {
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      if (pinnedConnectionId) headers["x-connection-id"] = pinnedConnectionId;
      if (useStreaming) headers["Accept"] = "text/event-stream";
      const body = { ...requestBody, model: modelFull };
      const res = await fetch(`/api${apiPathWithQuery}`, {
        method: kindConfig.endpoint.method,
        headers,
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error?.message || data?.error || `HTTP ${res.status}`);
        return;
      }
      const ctype = res.headers.get("content-type") || "";
      // Binary image response — convert to blob URL
      if (ctype.startsWith("image/")) {
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        setBinaryImageUrl(objUrl);
        setResult({ data: { binary: true, mime: ctype, size: blob.size }, latencyMs: Date.now() - start });
        return;
      }
      const isSse = ctype.includes("text/event-stream");
      if (isSse && res.body) {
        // Parse SSE: progress / partial_image / done / error
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let finalData = null;
        let streamErr = null;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let sep;
          while ((sep = buf.indexOf("\n\n")) !== -1) {
            const block = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            let evt = null,dataStr = "";
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) evt = line.slice(6).trim();else
              if (line.startsWith("data:")) dataStr += line.slice(5).trim();
            }
            if (!evt) continue;
            try {
              const payload = dataStr ? JSON.parse(dataStr) : {};
              if (evt === "progress") setProgress(payload);else
              if (evt === "partial_image") setPartialImage(payload);else
              if (evt === "done") finalData = payload;else
              if (evt === "error") streamErr = payload?.message || "Stream error";
            } catch {}
          }
        }
        const latencyMs = Date.now() - start;
        if (streamErr) {setError(streamErr);return;}
        if (finalData) setResult({ data: finalData, latencyMs });
      } else {
        const data = await res.json();
        const latencyMs = Date.now() - start;
        setResult({ data, latencyMs });
      }
    } catch (e) {
      setError(e.message || "Network error");
    } finally {
      setRunning(false);
    }
  };

  // Mask large b64_json strings in JSON view to keep it readable
  const maskB64 = (obj) => {
    if (!obj || !isObject(obj)) return obj;
    if (Array.isArray(obj)) return obj.map(maskB64);
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = k === "b64_json" && isString(v) && v.length > 100 ?
      `<${v.length} chars base64>` :
      maskB64(v);
    }
    return out;
  };
  const resultJson = result ? JSON.stringify(maskB64(result.data), null, 2) : "";

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold text-dd-text">Example</h2>
      <div className="flex flex-col gap-3">
        {kindModels.length > 0 ? (
          <Row label="Model"><Select aria-label="Model" value={selectedModel} onChange={setSelectedModel} options={kindModels.map((m) => ({ value: m.id, label: m.name || m.id }))} /></Row>
        ) : allowManualModel ? (
          <Row label="Model"><Input aria-label="Model" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} placeholder="Enter model id (provider-specific)" className="font-mono" /></Row>
        ) : null}

        <Row label="Endpoint">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="min-w-0 flex-1"><Input aria-label="Endpoint" value={`${endpoint}${apiPath}`} readOnly className="font-mono" /></div>
            {tunnelEndpoint && <Button size="sm" variant={useTunnel ? "primary" : "secondary"} icon="wifi_tethering" onClick={() => setUseTunnel((v) => !v)}>{useTunnel ? "Tunnel" : "Local"}</Button>}
          </div>
        </Row>

        <Row label="API Key"><Input aria-label="API Key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" placeholder="Paste a saved API key secret" className="font-mono" /></Row>

        {connections.length > 0 && (
          <Row label="Connection">
            <Select
              aria-label="Connection"
              value={pinnedConnectionId}
              onChange={setPinnedConnectionId}
              placeholder="Auto (by priority)"
              options={[{ value: "", label: "Auto (by priority)" }, ...connections.map((c) => {
                const plan = c.providerSpecificData?.chatgptPlanType;
                const label = c.email || c.name || c.id.slice(0, 8);
                return { value: c.id, label: `${label}${plan ? ` [${plan}]` : ""}` };
              })]}
            />
          </Row>
        )}

        <Row label={exConfig.inputLabel}>
          <div className="relative">
            <Input aria-label={exConfig.inputLabel} value={input} onChange={(e) => setInput(e.target.value)} placeholder={exConfig.inputPlaceholder} className="pe-12" />
            {input && <IconButton icon="close" label="Clear input" size="sm" onClick={() => setInput("")} className="absolute end-0 top-1/2 -translate-y-1/2" />}
          </div>
        </Row>

        {supportsEdit && (
          <Row label="Ref Image (URL)">
            <div className="flex flex-col gap-2">
              <div className="relative">
                <Input aria-label="Ref Image URL" value={refImage} onChange={(e) => setRefImage(e.target.value)} placeholder={imageEditDefaults.image || "https://example.com/source.png"} className="pe-12" />
                {refImage && <IconButton icon="close" label="Clear reference image" size="sm" onClick={() => setRefImage("")} className="absolute end-0 top-1/2 -translate-y-1/2" />}
              </div>
              {refImagePreviewSrc && <img src={refImagePreviewSrc} alt="Reference" className="mt-1.5 max-h-40 rounded-dd border border-dd-border bg-dd-surface-2 object-contain" onError={(e) => {e.currentTarget.style.display = "none";}} onLoad={(e) => {e.currentTarget.style.display = "block";}} />}
            </div>
          </Row>
        )}

        {supportsMask && (
          <Row label="Mask (URL)">
            <div className="flex flex-col gap-2">
              <div className="relative">
                <Input aria-label="Mask URL" value={maskImage} onChange={(e) => setMaskImage(e.target.value)} placeholder={imageEditDefaults.mask_image || "https://example.com/mask.png"} className="pe-12" />
                {maskImage && <IconButton icon="close" label="Clear mask image" size="sm" onClick={() => setMaskImage("")} className="absolute end-0 top-1/2 -translate-y-1/2" />}
              </div>
              {maskImagePreviewSrc && <img src={maskImagePreviewSrc} alt="Mask" className="mt-1.5 max-h-40 rounded-dd border border-dd-border bg-dd-surface-2 object-contain" onError={(e) => {e.currentTarget.style.display = "none";}} onLoad={(e) => {e.currentTarget.style.display = "block";}} />}
            </div>
          </Row>
        )}

        {(exConfig.extraFields || [])
          .filter((f) => kindModels.length === 0 || (Array.isArray(selectedModelObj?.params) && selectedModelObj.params.includes(f.key)))
          .map((f) => (
            <Row key={f.key} label={f.label}>
              {f.type === "select" ? (
                <Select aria-label={f.label} value={extraValues[f.key] ?? ""} onChange={(value) => setExtraValues((s) => ({ ...s, [f.key]: value }))} options={(f.options || []).map((opt) => ({ value: opt, label: opt === "" ? "(default)" : opt }))} />
              ) : f.type === "text" ? (
                <Input aria-label={f.label} type="text" value={extraValues[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => setExtraValues((s) => ({ ...s, [f.key]: e.target.value }))} />
              ) : (
                <Input aria-label={f.label} type="number" value={extraValues[f.key] ?? ""} min={f.min} max={f.max} onChange={(e) => setExtraValues((s) => ({ ...s, [f.key]: e.target.value === "" ? "" : Number(e.target.value) }))} />
              )}
            </Row>
          ))}

        {kind === "image" && (
          <Row label="Output Format">
            <Select aria-label="Output Format" value={imageOutputFormat} onChange={setImageOutputFormat} options={[{ value: "json", label: "JSON (Base64)" }, { value: "binary", label: "Binary File" }]} />
          </Row>
        )}

        <div className="mt-1">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-dd-muted">Request</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" icon={copiedCurl ? "check" : "content_copy"} onClick={() => copyCurl(curlSnippet)}>{copiedCurl ? "Copied" : "Copy"}</Button>
              <Button size="sm" variant="primary" icon="play_arrow" loading={running} onClick={handleRun} disabled={!input.trim() || !modelFull}>Run</Button>
            </div>
          </div>
          <pre tabIndex={0} aria-label="Request example" className="overflow-x-auto whitespace-pre-wrap break-all rounded-dd bg-dd-surface-2 p-3 text-xs text-dd-text" role="region">{curlSnippet}</pre>
        </div>

        {(running || progress) && useStreaming && (
          <div className="flex flex-col gap-2 rounded-dd border border-dd-border bg-dd-surface-2 px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
            <span aria-hidden="true" className={`material-symbols-outlined text-[16px] text-dd-accent ${running ? "animate-spin" : ""}`}>{running ? "progress_activity" : "check_circle"}</span>
            <span className="text-xs text-dd-muted">{progress?.stage || "starting"}{!running && progress?.bytesReceived ? ` · ${(progress.bytesReceived / 1024).toFixed(1)} KB` : ""}</span>
          </div>
        )}

        {partialImage?.b64_json && !result && (
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-dd-muted">Partial preview</span>
            <img src={`data:image/png;base64,${partialImage.b64_json}`} alt="Partial" className="mt-1.5 max-w-full rounded-dd border border-dd-border opacity-80" />
          </div>
        )}

        {error && <p role="alert" className="break-words text-xs text-dd-danger">{error}</p>}

        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-dd-muted">Response {result && <span className="font-normal normal-case">⚡ {result.latencyMs}ms</span>}</span>
            {result && <Button size="sm" variant="ghost" icon={copiedRes ? "check" : "content_copy"} onClick={() => copyRes(resultJson)}>{copiedRes ? "Copied" : "Copy"}</Button>}
          </div>
          <pre tabIndex={0} aria-label="Response output" className="overflow-x-auto whitespace-pre-wrap break-all rounded-dd bg-dd-surface-2 p-3 text-xs text-dd-text" role="region">{result ? resultJson : exConfig.defaultResponse}</pre>
          {kind === "image" && (binaryImageUrl || result?.data?.data?.[0]) && (
            <div className="mt-2">
              <div className="mb-1.5 flex items-center justify-end">
                <a href={binaryImageUrl || (result?.data?.data?.[0]?.b64_json ? `data:image/png;base64,${result.data.data[0].b64_json}` : result?.data?.data?.[0]?.url || "")} download="image.png" className="inline-flex items-center gap-1 text-xs text-dd-muted outline-none transition-colors hover:text-dd-accent focus-visible:shadow-dd-focus">
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px]">download</span>Download
                </a>
              </div>
              <img src={binaryImageUrl || (result?.data?.data?.[0]?.b64_json ? `data:image/png;base64,${result.data.data[0].b64_json}` : result?.data?.data?.[0]?.url)} alt="Generated" className="max-w-full rounded-dd border border-dd-border" />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
