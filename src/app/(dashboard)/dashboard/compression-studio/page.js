"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Card,
  Button,
  Select,
  Toggle,
  Input,
  ModelSelectModal,
} from "@/shared/components";
import { filterActiveConnections } from "@/shared/utils/connectionStatus";
import { ENGINE_IDS, isEngineAvailable, engineMeta } from "open-sse/services/compression/engineCatalog.js";

const PRESETS = [
  {
    label: "Simple chat",
    icon: "chat_bubble",
    value: {
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "hello" }],
    },
  },
  {
    label: "Multi-turn conversation",
    icon: "forum",
    value: {
      model: "openai/gpt-4o",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "What is token compression?" },
        { role: "assistant", content: "It reduces the number of tokens sent to the model." },
        { role: "user", content: "Why does that matter?" },
      ],
    },
  },
  {
    label: "Repeated code block",
    icon: "code_blocks",
    value: {
      model: "openai/gpt-4o",
      messages: [
        { role: "system", content: "You review code snippets." },
        { role: "user", content: "Fix this function:\n\n```js\nfunction add(a, b) { return a + b; }\n```\n\n```js\nfunction add(a, b) { return a + b; }\n```" },
      ],
    },
  },
  {
    label: "Long system prompt",
    icon: "notes",
    value: {
      model: "anthropic/claude-3-5-sonnet-20240620",
      messages: [
        { role: "system", content: "You are a senior software engineer. You write concise, well-tested code. You prefer TypeScript, React hooks, and small pure functions. You never emit comments that restate the code." },
        { role: "user", content: "Write a useDebounce hook." },
      ],
    },
  },
];

function buildPayload(useAdvanced, model, inputText, parsedJSON) {
  if (useAdvanced) {
    return parsedJSON || null;
  }
  if (model || inputText) {
    return {
      model: model || "openai/gpt-4o",
      messages: [{ role: "user", content: inputText || "" }],
    };
  }
  return null;
}

export default function CompressionStudioPage() {
  const [model, setModel] = useState("");
  const [inputText, setInputText] = useState("");
  const [advancedJSON, setAdvancedJSON] = useState("");
  const [useAdvanced, setUseAdvanced] = useState(false);
  const [engineId, setEngineId] = useState("all");
  const [selectedPreset, setSelectedPreset] = useState("");
  const [results, setResults] = useState(null);
  const [engines, setEngines] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [rawOpen, setRawOpen] = useState({});
  const [modalOpen, setModalOpen] = useState(false);
  const [activeProviders, setActiveProviders] = useState([]);
  const [activeProvidersError, setActiveProvidersError] = useState(false);

  const engineOptions = useMemo(() => {
    const options = [{ value: "all", label: "All engines" }];
    for (const id of ENGINE_IDS) {
      const meta = engineMeta(id);
      const available = isEngineAvailable(id);
      options.push({
        value: id,
        label: available ? meta.label : `${meta.label} (unavailable)`,
        disabled: !available,
      });
    }
    return options;
  }, []);

  const selectedEngine = engineId === "all" ? "" : engineId;

  const presetOptions = useMemo(
    () => PRESETS.map((p) => ({ value: p.label, label: p.label })),
    []
  );

  const parsedJSON = useMemo(() => {
    if (!useAdvanced || !advancedJSON.trim()) return null;
    try {
      return JSON.parse(advancedJSON);
    } catch {
      return null;
    }
  }, [useAdvanced, advancedJSON]);

  const isPayloadValid = useMemo(() => {
    if (useAdvanced) return parsedJSON !== null && typeof parsedJSON === "object" && !Array.isArray(parsedJSON);
    return model.trim() !== "" || inputText.trim() !== "";
  }, [useAdvanced, parsedJSON, model, inputText]);

  const validateAndGetPayload = () => {
    if (useAdvanced) {
      if (parsedJSON === null) return { error: "Please enter valid JSON payload." };
      if (typeof parsedJSON !== "object" || Array.isArray(parsedJSON) || parsedJSON === null) {
        return { error: "Advanced payload must be a JSON object (not an array or scalar)." };
      }
      return { payload: parsedJSON };
    }
    const payload = buildPayload(false, model, inputText, null);
    if (!payload) return { error: "Please enter a model or input text." };
    return { payload };
  };

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((d) => {
        setActiveProviders(filterActiveConnections(d.connections));
        setActiveProvidersError(false);
      })
      .catch(() => setActiveProvidersError(true));
  }, []);

  // Sync structured model from advanced JSON so the picker and structured
  // mode stay consistent after presets or manual JSON edits.
  useEffect(() => {
    if (!useAdvanced) return;
    try {
      const parsed = JSON.parse(advancedJSON || "{}");
      setModel(typeof parsed.model === "string" ? parsed.model : "");
    } catch {
      // leave model as-is while JSON is invalid
    }
  }, [advancedJSON, useAdvanced]);

  const handlePresetChange = (e) => {
    const label = e.target.value;
    setSelectedPreset(label);
    const preset = PRESETS.find((p) => p.label === label);
    if (!preset) return;
    setAdvancedJSON(JSON.stringify(preset.value, null, 2));
    setUseAdvanced(true);
  };

  const handleModelSelect = (selected) => {
    const nextModel = selected?.value || "";
    setModel(nextModel);
    if (useAdvanced) {
      try {
        const parsed = JSON.parse(advancedJSON || "{}");
        parsed.model = nextModel;
        setAdvancedJSON(JSON.stringify(parsed, null, 2));
      } catch {
        // invalid JSON: keep model change; do not overwrite advanced JSON
      }
    }
  };

  const handleRun = async () => {
    setLoading(true);
    setError("");
    setResults(null);

    const { payload, error: payloadError } = validateAndGetPayload();
    if (payloadError) {
      setLoading(false);
      setError(payloadError);
      return;
    }

    const { engine: _ignored, ...cleanPayload } = payload;
    const body = selectedEngine
      ? { engine: selectedEngine, ...cleanPayload }
      : cleanPayload;

    try {
      const res = await fetch("/api/compression/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || `Preview failed (${res.status})`);
      }
      const data = await res.json();
      setEngines(Array.isArray(data.engines) ? data.engines : []);
      setResults(data.results || {});
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const toggleRaw = (id) => {
    setRawOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Test Savers</h1>
        <p className="text-sm text-text-muted">
          Preview how each compression engine would transform a request body.
        </p>
      </div>

      <Card className="p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Engine"
            value={engineId}
            onChange={(e) => setEngineId(e.target.value)}
            options={engineOptions}
            placeholder="All engines"
            hint="Choose one engine or run all available engines."
          />
          <Select
            label="Example preset"
            value={selectedPreset}
            onChange={handlePresetChange}
            options={presetOptions}
            placeholder="Select a preset"
            hint="Pick a sample request to prefill the form."
          />
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setModalOpen(true)}
            icon="swap_horiz"
          >
            {model ? `Model: ${model}` : "Select model"}
          </Button>
          {activeProvidersError && (
            <span className="text-xs text-red-500">Could not load providers</span>
          )}
        </div>

        <Toggle
          checked={useAdvanced}
          onChange={setUseAdvanced}
          label="Advanced JSON mode"
          description="Edit the raw request JSON directly."
        />

        {useAdvanced ? (
          <div className="space-y-2">
            <label className="block text-sm font-medium" htmlFor="compression-json">
              Request body (JSON)
            </label>
            <textarea
              id="compression-json"
              className="w-full h-56 font-mono text-sm p-3 rounded-[10px] border border-transparent bg-surface-2 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40"
              value={advancedJSON}
              onChange={(e) => setAdvancedJSON(e.target.value)}
              spellCheck={false}
            />
            {!parsedJSON && advancedJSON.trim() !== "" && (
              <p className="text-xs text-red-500">Input is not valid JSON.</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <Input
              label="Model"
              placeholder="openai/gpt-4o"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              hint="The model ID sent in the request body."
            />
            <div className="space-y-2">
              <label className="block text-sm font-medium" htmlFor="compression-input">
                Input text
              </label>
              <textarea
                id="compression-input"
                className="w-full h-40 font-mono text-sm p-3 rounded-[10px] border border-transparent bg-surface-2 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Type a user message..."
                spellCheck={false}
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button onClick={handleRun} disabled={loading || !isPayloadValid}>
            {loading ? "Running…" : "Run preview"}
          </Button>
          {!isPayloadValid && (
            <span className="text-xs text-text-muted">
              Fill the form or switch to advanced JSON to run.
            </span>
          )}
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </Card>

      <ModelSelectModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSelect={handleModelSelect}
        selectedModel={model || ""}
        activeProviders={activeProviders}
        title="Select model"
      />

      {results && (
        <Card className="p-4">
          <h2 className="text-lg font-medium mb-3">Results</h2>
          {engines.length === 0 ? (
            <p className="text-sm text-text-muted">No engines reported.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-border-subtle">
                  <th className="py-2">Engine</th>
                  <th className="py-2">Compressed</th>
                  <th className="py-2">Est. savings</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {engines.map((id) => {
                  const r = results[id] || {};
                  const unavailable = r.status === "unavailable";
                  const errored = r.status === "error";
                  const raw = r.raw ?? r.compressedBody;
                  return (
                    <tr key={id} className="border-b border-border-subtle last:border-0">
                      <td className="py-2 font-mono">{id}</td>
                      <td className="py-2">
                        {unavailable ? "unavailable" : errored ? "error" : r.compressed ? "yes" : "no"}
                      </td>
                      <td className="py-2">
                        {unavailable || errored ? "—" : `${Number(r.savingsPercent || 0).toFixed(2)}%`}
                      </td>
                      <td className="py-2 text-right">
                        {!unavailable && !errored && raw !== undefined && (
                          <button
                            type="button"
                            onClick={() => toggleRaw(id)}
                            className="text-xs text-primary underline hover:opacity-80"
                          >
                            {rawOpen[id] ? "Hide raw JSON" : "Show raw JSON"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {Object.entries(rawOpen)
            .filter(([, open]) => open)
            .map(([id]) => {
              const r = results[id] || {};
              const raw = r.raw ?? r.compressedBody;
              return (
                <div key={`${id}-raw`} className="mt-3">
                  <p className="text-xs font-semibold text-text-muted mb-1">{id} raw output</p>
                  <pre className="w-full h-40 font-mono text-xs p-3 rounded-[10px] border border-border-subtle bg-surface-2 overflow-auto">
                    {typeof raw === "string" ? raw : JSON.stringify(raw, null, 2)}
                  </pre>
                </div>
              );
            })}
        </Card>
      )}
    </div>
  );
}
