"use client";

import { useEffect, useState } from "react";
import { ModelSelectModal } from "@/shared/components";
import { Card } from "@/shared/ui/components/Card";
import Button from "@/shared/ui/components/Button";
import IconButton from "@/shared/ui/components/IconButton";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import Image from "next/image";
import ApiKeySelect from "./ApiKeySelect";
import BaseUrlSelect from "./BaseUrlSelect";

export default function DefaultToolCard({ toolId, tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders = [], cloudEnabled = false, cloudUrl = "", tunnelEnabled = false, tunnelPublicUrl = "", tailscaleEnabled = false, tailscaleUrl = "" }) {
  const [copiedField, setCopiedField] = useState(null);
  const [showModelModal, setShowModelModal] = useState(false);
  const [modelValue, setModelValue] = useState("");
  
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState(baseUrl);
  useEffect(() => setCustomBaseUrl(baseUrl), [baseUrl]);

  const replaceVars = (text) => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim()) 
      ? selectedApiKey 
      : (!cloudEnabled ? "sk_durindoor" : "your-api-key");
    
    // Add /v1 suffix only if not already present (DRY - avoid duplicate)
    const normalizedBaseUrl = customBaseUrl || baseUrl || "http://localhost:20128";
    const baseUrlWithV1 = normalizedBaseUrl.endsWith("/v1") 
      ? normalizedBaseUrl 
      : `${normalizedBaseUrl}/v1`;
    
    return text
      .replace(/\{\{baseUrl\}\}/g, baseUrlWithV1)
      .replace(/\{\{apiKey\}\}/g, keyToUse)
      .replace(/\{\{model\}\}/g, modelValue || "provider/model-id");
  };

  const { copy: copyToClipboard } = useCopyToClipboard();

  const handleCopy = async (text, field) => {
    await copyToClipboard(replaceVars(text), `toolcard-${field}`);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleSelectModel = (model) => {
    setModelValue(model.value);
  };

  const hasActiveProviders = activeProviders.length > 0;

  const renderApiKeySelector = () => (
    <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
      <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} className="flex-1" />
    </div>
  );

  const renderModelSelector = () => {
    return (
      <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
        <input
          type="text" aria-label="Model ID"
          value={modelValue}
          onChange={(e) => setModelValue(e.target.value)}
          placeholder="provider/model-id"
          className="w-full sm:w-auto flex-1 px-3 py-2 bg-dd-surface-2 rounded-dd-lg text-sm border border-dd-border focus:outline-none focus:ring-1 focus-visible:shadow-dd-focus"
        />
        <Button
          onClick={() => setShowModelModal(true)}
          disabled={!hasActiveProviders}
          className={`shrink-0 px-3 py-2 rounded-dd-lg border text-sm transition-colors ${
            hasActiveProviders
              ? "bg-dd-surface-2 border-dd-border text-dd-text hover:border-dd-accent cursor-pointer"
              : "opacity-50 cursor-not-allowed border-dd-border"
          }`}
        >
          Select Model
        </Button>
        {modelValue && (
          <>
            <IconButton icon={copiedField === "model" ? "check" : "content_copy"} label="Copy model" size="sm" onClick={() => handleCopy(modelValue, "model")} className="border border-dd-border" />
            <IconButton icon="close" label="Clear model" size="sm" onClick={() => setModelValue("")} className="text-dd-muted hover:text-dd-danger" />
          </>
        )}
      </div>
    );
  };

  const renderNotes = () => {
    if (!tool.notes || tool.notes.length === 0) return null;
    
    return (
      <div className="flex flex-col gap-2 mb-4">
        {tool.notes.map((note, index) => {
          // Skip cloudCheck note if tunnel or cloud is enabled
          if (note.type === "cloudCheck" && (cloudEnabled || tunnelEnabled)) return null;
          
          const isWarning = note.type === "warning";
          const isError = note.type === "error" || (note.type === "cloudCheck" && !cloudEnabled && !tunnelEnabled);
          
          let bgClass = "bg-dd-info/10 border-dd-info/30";
          let textClass = "text-dd-info";
          let iconClass = "text-dd-info";
          let icon = "info";
          
          if (isWarning) {
            bgClass = "bg-dd-warning/10 border-dd-warning/30";
            textClass = "text-dd-warning";
            iconClass = "text-dd-warning";
            icon = "warning";
          } else if (isError) {
            bgClass = "bg-dd-danger/10 border-dd-danger/30";
            textClass = "text-dd-danger";
            iconClass = "text-dd-danger";
            icon = "error";
          }
          
          return (
            <div key={index} className={`flex items-start gap-3 p-3 rounded-dd-lg border ${bgClass}`}>
              <span aria-hidden="true" className={`material-symbols-outlined text-lg ${iconClass}`}>{icon}</span>
              <p className={`text-sm ${textClass}`}>{note.text}</p>
            </div>
          );
        })}
      </div>
    );
  };

  const canShowGuide = () => {
    if (tool.requiresExternalUrl && !cloudEnabled && !tunnelEnabled) return false;
    if (tool.requiresCloud && !cloudEnabled) return false;
    return true;
  };

  const renderGuideSteps = () => {
    if (!tool.guideSteps) return renderNotes() || <p className="text-dd-muted text-sm">Coming soon...</p>;

    return (
      <div className="flex flex-col gap-4">
        {renderNotes()}
        {canShowGuide() && tool.guideSteps.map((item) => (
          <div key={item.step} className="flex items-start gap-4">
            <div 
              className="size-8 shrink-0 rounded-full bg-dd-accent text-dd-on-accent flex items-center justify-center text-sm font-semibold"
            >
              {item.step}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-dd-text">{item.title}</p>
              {item.desc && <p className="text-sm text-dd-muted mt-0.5">{item.desc}</p>}
              {item.type === "apiKeySelector" && renderApiKeySelector()}
              {item.type === "baseUrlSelector" && (
                <div className="mt-2">
                  <BaseUrlSelect
                    value={customBaseUrl}
                    onChange={setCustomBaseUrl}
                    tunnelEnabled={tunnelEnabled}
                    tunnelPublicUrl={tunnelPublicUrl}
                    tailscaleEnabled={tailscaleEnabled}
                    tailscaleUrl={tailscaleUrl}
                    cloudEnabled={cloudEnabled}
                    cloudUrl={cloudUrl}
                  />
                </div>
              )}
              {item.type === "modelSelector" && renderModelSelector()}
              {item.value && (
                <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
                  <code className="w-full sm:w-auto flex-1 px-3 py-2 bg-dd-surface-2 rounded-dd-lg text-sm font-mono border border-dd-border truncate">
                    {replaceVars(item.value)}
                  </code>
                  {item.copyable && (
                    <IconButton icon={copiedField === `${item.step}-${item.title}` ? "check" : "content_copy"} label={`Copy ${item.title}`} size="sm" onClick={() => handleCopy(item.value, `${item.step}-${item.title}`)} className="border border-dd-border" />
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {canShowGuide() && tool.codeBlock && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-dd-muted uppercase tracking-wide">{tool.codeBlock.language}</span>
              <Button
                onClick={() => handleCopy(tool.codeBlock.code, "codeblock")}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-dd-surface-2 hover:bg-dd-surface-3 rounded-dd border border-dd-border transition-colors"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-sm">
                  {copiedField === "codeblock" ? "check" : "content_copy"}
                </span>
                {copiedField === "codeblock" ? "Copied!" : "Copy"}
              </Button>
            </div>
            <pre tabIndex={0} aria-label={`${tool.name} configuration`} className="p-4 bg-dd-surface-2 rounded-dd-lg border border-dd-border overflow-x-auto" role="region">
              <code className="text-sm font-mono whitespace-pre">{replaceVars(tool.codeBlock.code)}</code>
            </pre>
          </div>
        )}
      </div>
    );
  };

  const renderIcon = () => {
    if (tool.image) {
      return (
        <Image
          src={tool.image}
          alt={tool.name}
          width={32}
          height={32}
          className="size-8 object-contain rounded-dd-lg"
          sizes="32px"
          onError={(e) => { e.target.style.display = "none"; }}
        />
      );
    }
    if (tool.icon) {
      return <span aria-hidden="true" className="material-symbols-outlined text-xl text-dd-accent">{tool.icon}</span>;
    }
    return (
      <Image
        src={`/providers/${toolId}.png`}
        alt={tool.name}
        width={32}
        height={32}
        className="size-8 object-contain rounded-dd-lg"
        sizes="32px"
        onError={(e) => { e.target.style.display = "none"; }}
      />
    );
  };

  return (
    <Card padding={false} className="overflow-hidden overflow-x-hidden p-4">
      <button type="button" aria-expanded={isExpanded} className="w-full text-left outline-none focus-visible:shadow-dd-focus flex items-center justify-between hover:cursor-pointer" onClick={onToggle}>

        <div className="flex items-center gap-3">
          <div className="size-8 rounded-dd-lg flex items-center justify-center shrink-0">
            {renderIcon()}
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-sm">{tool.name}</h3>
            <p className="text-xs text-dd-muted truncate">{tool.description}</p>
          </div>
        </div>
        <span aria-hidden="true" className={`material-symbols-outlined text-dd-muted text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`}>expand_more</span>
      </button>

      {isExpanded && (
        <div className="mt-6 pt-6 border-t border-dd-border">
          {renderGuideSteps()}
        </div>
      )}

      <ModelSelectModal
        isOpen={showModelModal}
        onClose={() => setShowModelModal(false)}
        onSelect={handleSelectModel}
        selectedModel={modelValue}
        activeProviders={activeProviders}
        title="Select Model"
      />
    </Card>
  );
}
