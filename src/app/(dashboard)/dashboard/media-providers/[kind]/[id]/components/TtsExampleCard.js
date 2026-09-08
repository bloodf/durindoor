"use client";

import { useState, useEffect } from "react";
import { Card } from "@/shared/ui/components/Card.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import { Chip } from "@/shared/ui/components/Chip.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import { AI_PROVIDERS, getProviderAlias } from "@/shared/constants/providers";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { TTS_PROVIDER_CONFIG } from "@/shared/constants/ttsProviders";
import { getTtsVoicesForModel } from "open-sse/config/ttsModels.js";
import { GOOGLE_TTS_LANGUAGES } from "open-sse/config/googleTtsLanguages.js";
import { Row } from "./exampleShared";

const DEFAULT_TTS_RESPONSE_EXAMPLE = `// Audio will appear here after running.
// Example JSON response (response_format=json):
{
  "format": "mp3",
  "audio": "//NExAANaAIIAUAAANNNNNNNN..." // base64 encoded MP3
}`;

export function TtsExampleCard({ providerId }) {
  const providerAlias = getProviderAlias(providerId);
  const config = TTS_PROVIDER_CONFIG[providerId] || TTS_PROVIDER_CONFIG["edge-tts"];

  // Voice state
  const [selectedVoice, setSelectedVoice]     = useState(config.defaultVoiceId || "");
  const [selectedVoiceName, setSelectedVoiceName] = useState("");
  const [voiceId, setVoiceId]               = useState(config.defaultVoiceId || ""); // editable voice id (elevenlabs/config providers)
  // Voices shown below Voice row after language selected
  const [countryVoices, setCountryVoices]     = useState([]);
  const [selectedLang, setSelectedLang]       = useState("");
  const [selectedModel, setSelectedModel]     = useState(() => {
    const cfgModels = AI_PROVIDERS[providerId]?.ttsConfig?.models;
    if (cfgModels?.length) return cfgModels[0].id;
    if (config.hasModelSelector && config.modelKey) {
      const models = getModelsByProviderId(config.modelKey);
      return models?.[0]?.id || "";
    }
    return "";
  });

  // Form state
  const [input, setInput]               = useState("Hello, this is a text to speech test.");
  const [apiKey, setApiKey]             = useState("");
  const [useTunnel, setUseTunnel]       = useState(false);
  const [localEndpoint, setLocalEndpoint]   = useState("");
  const [tunnelEndpoint, setTunnelEndpoint] = useState("");
  const [responseFormat, setResponseFormat] = useState("mp3"); // mp3 | json
  const [audioUrl, setAudioUrl]         = useState("");
  const [jsonResponse, setJsonResponse] = useState(null); // Store JSON response
  const [running, setRunning]           = useState(false);
  const [error, setError]               = useState("");
  const [latency, setLatency]           = useState(null);
  const { copied: copiedCurl, copy: copyCurl } = useCopyToClipboard();

  // Country picker modal state
  const [modalOpen, setModalOpen]           = useState(false);
  const [languages, setLanguages]           = useState([]);
  const [modalLoading, setModalLoading]     = useState(false);
  const [modalSearch, setModalSearch]       = useState("");
  const [modalError, setModalError]         = useState("");
  const [byLang, setByLang]                 = useState({});
  // Language hint (e.g. Gemini): controls the spoken language without affecting voice selection
  const [languageHint, setLanguageHint]     = useState("");

  useEffect(() => {
    setLocalEndpoint(window.location.origin);
    fetch("/api/tunnel/status")
      .then((r) => r.json())
      .then((d) => { if (d.publicUrl) setTunnelEndpoint(d.publicUrl); })
      .catch(() => {});

    // Pre-select default voice based on provider config
    if (config.voiceSource === "hardcoded") {
      const defaultModel = config.hasModelSelector && config.modelKey
        ? (getModelsByProviderId(config.modelKey)?.[0]?.id || "")
        : "";
      // Use per-model voices if available, else flat list
      const voices = (config.voicesPerModel && defaultModel)
        ? (getTtsVoicesForModel(providerId, defaultModel) || [])
        : getModelsByProviderId(config.voiceKey || providerId).filter((m) => getModelKind(m) === "tts");
      if (voices.length) {
        if (config.hasBrowseButton) {
          // Google TTS: pre-select "en" (English) as default, show as single voice chip
          const defaultVoice = voices.find((v) => v.id === "en") || voices[0];
          setSelectedLang(defaultVoice.id);
          setSelectedVoice(defaultVoice.id);
          setSelectedVoiceName(defaultVoice.name);
          setCountryVoices([{ id: defaultVoice.id, name: defaultVoice.name }]);
        } else {
          // OpenAI/OpenRouter: set voice chips directly (no language picker)
          setCountryVoices(voices);
          setSelectedVoice(voices[0].id);
          setSelectedVoiceName(voices[0].name || voices[0].id);
        }
      }
    }
    // api-language (edge-tts, local-device, elevenlabs): NO default load, wait for user to pick language
    // config (nvidia, hyperbolic, deepgram, huggingface, cartesia, playht, coqui, tortoise, inworld, qwen):
    // use ttsConfig.models for model selector; voice is empty by default (backend uses provider default)
  }, [providerId]);

  // Update voices when model changes (voicesPerModel providers)
  useEffect(() => {
    if (!config.voicesPerModel || !selectedModel) return;
    const voices = getTtsVoicesForModel(providerId, selectedModel) || [];
    setCountryVoices(voices);
    if (voices.length) {
      setSelectedVoice(voices[0].id);
      setSelectedVoiceName(voices[0].name || voices[0].id);
    }
  }, [selectedModel]);

  // Open modal — load language list
  const openModal = async () => {
    setModalOpen(true);
    setModalSearch("");
    setModalError("");
    if (languages.length) return; // already loaded
    setModalLoading(true);
    try {
      if (config.voiceSource === "hardcoded") {
        // Build languages/byLang from static providerModels data
        const voiceKey = config.voiceKey || providerId;
        const voices = getModelsByProviderId(voiceKey).filter((m) => getModelKind(m) === "tts");
        const byLangMap = {};
        for (const v of voices) {
          if (!byLangMap[v.id]) byLangMap[v.id] = { code: v.id, name: v.name, voices: [{ id: v.id, name: v.name }] };
        }
        setByLang(byLangMap);
        setLanguages(Object.values(byLangMap).sort((a, b) => a.name.localeCompare(b.name)));
      } else {
        // Use provider-specific apiEndpoint if available, else default to edge-tts voices API
        const url = config.apiEndpoint
          ? config.apiEndpoint
          : `/api/media-providers/tts/voices?provider=${providerId === "local-device" ? "local-device" : "edge-tts"}`;
        const r = await fetch(url);
        const d = await r.json();
        if (d.error) { setModalError(d.error); return; }
        setLanguages(d.languages || []);
        setByLang(d.byLang || {});
      }
    } catch (e) {
      setModalError(e.message);
    } finally {
      setModalLoading(false);
    }
  };

  // Click language → close modal → show voices below
  const handlePickLanguage = (lang) => {
    setModalOpen(false);
    setSelectedLang(lang.code);
    const voices = byLang[lang.code]?.voices || [];
    setCountryVoices(voices);
    // Auto-select first voice
    if (voices.length) {
      setSelectedVoice(voices[0].id);
      setSelectedVoiceName(voices[0].name);
      if (config.hasVoiceIdInput) setVoiceId(voices[0].id);
    }
  };

  const filteredLanguages = modalSearch
    ? languages.filter((c) =>
        c.name.toLowerCase().includes(modalSearch.toLowerCase()) ||
        c.code.toLowerCase().includes(modalSearch.toLowerCase())
      )
    : languages;

  const endpoint = useTunnel ? tunnelEndpoint : localEndpoint;
  // For ElevenLabs/config-driven: prefer manual voiceId (if any), else fall back to selectedVoice
  const activeVoiceId = config.hasVoiceIdInput ? (voiceId || selectedVoice) : selectedVoice;
  const modelFull = (() => {
    if (config.hasModelSelector && selectedModel && activeVoiceId) return `${providerAlias}/${selectedModel}/${activeVoiceId}`;
    if (config.hasModelSelector && selectedModel) return `${providerAlias}/${selectedModel}`;
    if (activeVoiceId) return `${providerAlias}/${activeVoiceId}`;
    return "";
  })();

  const ttsBody = (() => {
    const b = { model: modelFull, input };
    if (config.hasLanguageHint && languageHint) b.language = languageHint;
    return b;
  })();
  const curlSnippet = `curl -X POST ${endpoint}/v1/audio/speech${responseFormat === "json" ? "?response_format=json" : ""} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey || "YOUR_KEY"}" \\
  -d '${JSON.stringify(ttsBody)}' \\
  ${responseFormat === "json" ? "" : "--output speech.mp3"}`;

  const handleRun = async () => {
    if (!input.trim() || !modelFull) return;
    setRunning(true);
    setError("");
    setAudioUrl("");
    setJsonResponse(null);
    const start = Date.now();
    try {
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const url = `/api/v1/audio/speech${responseFormat === "json" ? "?response_format=json" : ""}`;
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...ttsBody, input: input.trim() }),
      });
      setLatency(Date.now() - start);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error?.message || d?.error || `HTTP ${res.status}`);
        return;
      }
      
      if (responseFormat === "json") {
        const data = await res.json();
        setJsonResponse(data); // Store full JSON response
        const audioBlob = await fetch(`data:audio/mp3;base64,${data.audio}`).then(r => r.blob());
        setAudioUrl(URL.createObjectURL(audioBlob));
      } else {
        const blob = await res.blob();
        setAudioUrl(URL.createObjectURL(blob));
      }
    } catch (e) {
      setError(e.message || "Network error");
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Card>
        <h2 className="mb-4 text-lg font-semibold text-dd-text">Example</h2>
        <div className="flex flex-col gap-3">
          <Row label="Endpoint">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="min-w-0 flex-1"><Input aria-label="Endpoint" value={`${endpoint}/v1/audio/speech`} readOnly className="font-mono" /></div>
              {tunnelEndpoint && <Button size="sm" variant={useTunnel ? "primary" : "secondary"} icon="wifi_tethering" onClick={() => setUseTunnel((v) => !v)}>{useTunnel ? "Tunnel" : "Local"}</Button>}
            </div>
          </Row>
          <Row label="API Key"><Input aria-label="API Key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" placeholder="Paste a saved API key secret" className="font-mono" /></Row>

          {config.hasModelSelector && (config.modelKey || getModelsByProviderId(providerId).some((m) => getModelKind(m) === "tts")) && (() => {
            const ttsModels = getModelsByProviderId(providerId).filter((m) => getModelKind(m) === "tts");
            const list = ttsModels.length ? ttsModels : getModelsByProviderId(config.modelKey) || [];
            return <Row label="Model"><Select aria-label="Model" value={selectedModel} onChange={setSelectedModel} options={list.map((m) => ({ value: m.id, label: m.name || m.id }))} /></Row>;
          })()}

          {config.hasLanguageHint && (
            <Row label="Language">
              <Select aria-label="Language" value={languageHint} onChange={setLanguageHint} options={[{ value: "", label: "Auto-detect" }, ...GOOGLE_TTS_LANGUAGES.map((l) => ({ value: l.name, label: l.name }))]} />
            </Row>
          )}

          {config.hasBrowseButton && (
            <Row label="Language">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button size="md" variant="secondary" onClick={openModal} className="flex-1 justify-start font-mono">
                  {selectedLang ? <span className="text-dd-text">{languages.find((l) => l.code === selectedLang)?.name || selectedLang}</span> : <span className="text-dd-muted">No language selected</span>}
                </Button>
                <Button size="md" variant="secondary" icon="language" onClick={openModal} className="shrink-0">Select language</Button>
              </div>
            </Row>
          )}

          {countryVoices.length > 0 && (
            <Row label="Voice">
              <div className="flex flex-wrap gap-1.5">
                {countryVoices.map((v) => (
                  <Chip
                    key={v.id}
                    selected={selectedVoice === v.id}
                    label={`${v.name}${v.gender ? ` · ${v.gender[0].toUpperCase()}` : ""}${v.free_users_allowed === true ? " · Free" : v.free_users_allowed === false ? " · Paid" : ""}`}
                    onClick={() => {
                      setSelectedVoice(v.id);
                      setSelectedVoiceName(v.name);
                      if (config.hasVoiceIdInput) setVoiceId(v.id);
                    }}
                  />
                ))}
              </div>
            </Row>
          )}

          {config.hasVoiceIdInput && (
            <Row label="Voice ID">
              <div className="relative">
                <Input aria-label="Voice ID" value={voiceId} onChange={(e) => { setVoiceId(e.target.value); setSelectedVoice(e.target.value); }} placeholder="e.g. CwhRBWXzGAHq8TQ4Fs17" className="pe-12 font-mono" />
                {voiceId && <IconButton icon="close" label="Clear voice id" size="sm" onClick={() => { setVoiceId(""); setSelectedVoice(""); }} className="absolute end-0 top-1/2 -translate-y-1/2" />}
              </div>
            </Row>
          )}

          {config.hasLanguageDropdown && (
            <Row label="Language">
              <Select
                aria-label="Language"
                value={selectedVoice}
                onChange={(value) => {
                  const match = getModelsByProviderId(providerId).filter((m) => getModelKind(m) === "tts").find((m) => m.id === value);
                  setSelectedVoice(value);
                  setSelectedVoiceName(match?.name || value);
                }}
                options={getModelsByProviderId(providerId).filter((m) => getModelKind(m) === "tts").map((m) => ({ value: m.id, label: m.name || m.id }))}
              />
            </Row>
          )}

          <Row label="Input">
            <div className="relative">
              <Input aria-label="Input" value={input} onChange={(e) => setInput(e.target.value)} className="pe-12" />
              {input && <IconButton icon="close" label="Clear input" size="sm" onClick={() => setInput("")} className="absolute end-0 top-1/2 -translate-y-1/2" />}
            </div>
          </Row>

          <Row label="Output Format">
            <Select aria-label="Output Format" value={responseFormat} onChange={setResponseFormat} options={[{ value: "mp3", label: "MP3 (Binary)" }, { value: "json", label: "JSON (Base64)" }]} />
          </Row>

          <div className="mt-1">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-dd-muted">Request</span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" icon={copiedCurl ? "check" : "content_copy"} onClick={() => copyCurl(curlSnippet)}>{copiedCurl ? "Copied" : "Copy"}</Button>
                <Button size="sm" variant="primary" icon="play_arrow" loading={running} onClick={handleRun} disabled={!input.trim() || !modelFull}>{running ? "Generating..." : "Run"}</Button>
              </div>
            </div>
            <pre tabIndex={0} aria-label="Request example" className="overflow-x-auto whitespace-pre-wrap break-all rounded-dd bg-dd-surface-2 p-3 text-xs text-dd-text" role="region">{curlSnippet}</pre>
          </div>

          {error && <p role="alert" className="break-words text-xs text-dd-danger">{error}</p>}

          {audioUrl ? (
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-dd-muted">Response {latency && <span className="font-normal normal-case">⚡ {latency}ms</span>}</span>
                <a href={audioUrl} download="speech.mp3" className="inline-flex items-center gap-1 text-xs text-dd-muted outline-none transition-colors hover:text-dd-accent focus-visible:shadow-dd-focus">
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px]">download</span>Download
                </a>
              </div>
              <audio controls src={audioUrl} className="w-full" />
              {jsonResponse && (
                <div className="mt-3">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-dd-muted">JSON Response</span>
                  </div>
                  <pre tabIndex={0} aria-label="JSON response output" className="overflow-x-auto whitespace-pre-wrap break-all rounded-dd bg-dd-surface-2 p-3 text-xs text-dd-text" role="region">{JSON.stringify({ format: jsonResponse.format, audio: jsonResponse.audio ? `${jsonResponse.audio.substring(0, 100)}...` : "" }, null, 2)}</pre>
                </div>
              )}
            </div>
          ) : (
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-dd-muted">Response</span>
              <pre tabIndex={0} aria-label="Example response output" className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-all rounded-dd bg-dd-surface-2 p-3 text-xs text-dd-text" role="region">{DEFAULT_TTS_RESPONSE_EXAMPLE}</pre>
            </div>
          )}
        </div>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Select Language" size="md">
        <div className="flex flex-col gap-3">
          <Input aria-label="Search language" autoFocus value={modalSearch} onChange={(e) => setModalSearch(e.target.value)} placeholder="Search language..." />
          {modalError && <p role="alert" className="break-words text-xs text-dd-danger">{modalError}</p>}
          {modalLoading ? (
            <p className="px-2 py-3 text-xs text-dd-muted">Loading...</p>
          ) : (
            <div tabIndex={0} aria-label="Available languages" className="flex max-h-[55vh] flex-col gap-1 overflow-y-auto" role="region">
              {filteredLanguages.map((c) => (
                <button
                  key={c.code}
                  onClick={() => handlePickLanguage(c)}
                  aria-pressed={selectedLang === c.code}
                  className={`flex w-full items-center justify-between rounded-dd px-3 py-2 text-start text-[13px] outline-none transition-colors hover:bg-dd-surface-2 focus-visible:shadow-dd-focus ${selectedLang === c.code ? "bg-dd-accent-soft text-dd-accent" : "text-dd-text"}`}
                >
                  <span>{c.name}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-dd-muted">{c.voices.length} voices{selectedLang === c.code && <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-dd-accent">check</span>}</span>
                </button>
              ))}
              {filteredLanguages.length === 0 && <p className="px-2 py-3 text-xs text-dd-muted">No languages found.</p>}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
