"use client";

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Button, Badge, Input, Modal, Select } from "@/shared/components";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import {
  buildGooglePseProviderSpecificData,
  isGooglePseProvider,
  normalizeGooglePseCx,
} from "@/shared/utils/googlePseProviderSpecificData";
import { defaultApiKeyConnectionName, shouldResetAddApiKeyModal } from "./apiKeyConnectionName";

const BULK_PLACEHOLDER = `name1|sk-key1\nname2|sk-key2\nsk-key-only-auto-named`;

export default function AddApiKeyModal({ isOpen, provider, providerName, isCompatible, isAnthropic, authType, authHint, website, proxyPools, existingConnectionNames = [], existingConnectionCount = 0, error, onSave, onBulkDone, onClose }) {
  const NONE_PROXY_POOL_VALUE = "__none__";
  const isFreeNoAuthProvider = provider === "mimocode";
  const isOllamaLocal = provider === "ollama-local";
  const providerInfo = AI_PROVIDERS?.[provider] || {};
  const isNoAuthProvider = providerInfo.noAuth === true;
  const supportsLocalBaseUrl = !!providerInfo.defaultBaseUrl && (isOllamaLocal || isNoAuthProvider);
  const isCookie = authType === "cookie";
  const isXaiApiKey = provider === "xai" && !isCookie;
  const credentialLabel = isCookie ? "Cookie Value" : "API Key";
  const credentialPlaceholder = isCookie
    ? (provider === "grok-web" ? "sso=xxxxx... or just the raw value" : "eyJhbGciOi...")
    : (isXaiApiKey ? "xai-..." : "");

  const isAzure = provider === "azure";
  const ACCOUNT_ID_PROVIDER_DETAILS = ["cloudflare-ai", "snowflake"];
  const requiresAccountId = ACCOUNT_ID_PROVIDER_DETAILS.includes(provider);
  const accountIdProviderLabel = provider === "snowflake" ? "Snowflake Cortex" : "Cloudflare Workers AI";
  const isGooglePse = isGooglePseProvider(provider);
  const providerRegions = AI_PROVIDERS?.[provider]?.regions || null;
  const defaultRegion = AI_PROVIDERS?.[provider]?.defaultRegion || providerRegions?.[0]?.id || "";

  const [formData, setFormData] = useState({
    name: defaultApiKeyConnectionName(existingConnectionNames.length ? existingConnectionNames : existingConnectionCount),
    apiKey: "",
    defaultModel: "",
    priority: 1,
    proxyPoolId: NONE_PROXY_POOL_VALUE,
    localBaseUrl: "",
  });
  const [azureData, setAzureData] = useState({
    azureEndpoint: "",
    apiVersion: "2024-10-01-preview",
    deployment: "",
    organization: "",
  });
  const [cloudflareData, setCloudflareData] = useState({ accountId: "" });
  const [googlePseData, setGooglePseData] = useState({ cx: "" });
  const [region, setRegion] = useState(defaultRegion);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState("single"); // "single" | "bulk"
  const [bulkText, setBulkText] = useState("");
  const [bulkResult, setBulkResult] = useState(null); // { success, failed }
  const wasOpenRef = useRef(false);

  useEffect(() => {
    const shouldReset = shouldResetAddApiKeyModal(wasOpenRef.current, isOpen);
    wasOpenRef.current = isOpen;
    if (shouldReset) {
      setFormData({
        name: defaultApiKeyConnectionName(existingConnectionNames.length ? existingConnectionNames : existingConnectionCount),
        apiKey: "",
        defaultModel: "",
        priority: 1,
        proxyPoolId: NONE_PROXY_POOL_VALUE,
        ollamaHostUrl: "",
      });
      setValidationResult(null);
      setMode("single");
      setBulkText("");
      setBulkResult(null);
    }
  }, [isOpen, existingConnectionNames, existingConnectionCount]);

  const buildProviderSpecificData = () => {
    if (supportsLocalBaseUrl && formData.localBaseUrl.trim()) {
      return { baseUrl: formData.localBaseUrl.trim() };
    }
    if (isAzure) {
      return {
        azureEndpoint: azureData.azureEndpoint,
        apiVersion: azureData.apiVersion,
        deployment: azureData.deployment,
        organization: azureData.organization,
      };
    }
    if (requiresAccountId) {
      return { accountId: cloudflareData.accountId };
    }
    if (isGooglePse) {
      return buildGooglePseProviderSpecificData(googlePseData.cx);
    }
    if (providerRegions && region) {
      return { region };
    }
    return undefined;
  };

  const hasRequiredGooglePseCx = !isGooglePse || !!normalizeGooglePseCx(googlePseData.cx);

  const handleValidate = async () => {
    if (!hasRequiredGooglePseCx) return;
    setValidating(true);
    try {
      const res = await fetch("/api/providers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: formData.apiKey, providerSpecificData: buildProviderSpecificData() }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async () => {
    if (!provider) return;
    if (!isOllamaLocal && !isNoAuthProvider && !isFreeNoAuthProvider && !formData.apiKey) return;
    if (!isOllamaLocal || isNoAuthProvider) {
      // Non-ollama providers require a name; optional local providers can save without a key.
      if (!formData.name) return;
    }
    if (isCompatible && !formData.defaultModel.trim()) return;
    if (!hasRequiredGooglePseCx) return;

    setSaving(true);
    try {
      let isValid = false;
      try {
        setValidating(true);
        setValidationResult(null);
        if (isFreeNoAuthProvider) {
          isValid = true;
          setValidationResult("success");
        } else {
          const res = await fetch("/api/providers/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider, apiKey: formData.apiKey, providerSpecificData: buildProviderSpecificData() }),
          });
          const data = await res.json();
          isValid = !!data.valid;
          setValidationResult(isValid ? "success" : "failed");
        }
      } catch {
        setValidationResult("failed");
      } finally {
        setValidating(false);
      }

      await onSave({
        name: formData.name || (isOllamaLocal ? "Ollama Local" : providerName || provider),
        apiKey: formData.apiKey,
        defaultModel: isCompatible ? formData.defaultModel.trim() : undefined,
        priority: formData.priority,
        proxyPoolId: formData.proxyPoolId === NONE_PROXY_POOL_VALUE ? null : formData.proxyPoolId,
        testStatus: isValid ? "active" : "unknown",
        providerSpecificData: buildProviderSpecificData()
      });
    } finally {
      setSaving(false);
    }
  };

  const handleBulkSubmit = async () => {
    const lines = bulkText.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    if (!hasRequiredGooglePseCx) return;
    setSaving(true);
    setBulkResult(null);
    let success = 0;
    let failed = 0;
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split("|");
      const apiKey = parts.length >= 2 ? parts.slice(1).join("|").trim() : parts[0].trim();
      const baseName = parts.length >= 2 ? parts[0].trim() : "Key";
      const name = `${baseName} ${i + 1}`;
      try {
        const res = await fetch("/api/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            apiKey,
            name,
            priority: 1,
            testStatus: "unknown",
            providerSpecificData: buildProviderSpecificData(),
          }),
        });
        if (res.ok) success++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setSaving(false);
    setBulkResult({ success, failed });
    if (success > 0 && onBulkDone) onBulkDone();
  };

  if (!provider) return null;

  return (
    <Modal isOpen={isOpen} title={`Add ${providerName || provider} ${credentialLabel}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {/* Mode switcher */}
        <div className="flex gap-2">
          <Button size="sm" variant={mode === "single" ? "primary" : "ghost"} onClick={() => { setMode("single"); setBulkResult(null); }}>Single</Button>
          <Button size="sm" variant={mode === "bulk" ? "primary" : "ghost"} onClick={() => { setMode("bulk"); setBulkResult(null); }}>Bulk Add</Button>
        </div>

        {isGooglePse && (
          <div className="bg-sidebar/50 p-4 rounded-lg border border-accent/20">
            <h3 className="font-semibold mb-3 text-sm">Google Programmable Search</h3>
            <Input
              label="Search Engine ID (cx)"
              value={googlePseData.cx}
              onChange={(e) => setGooglePseData({ cx: e.target.value })}
              placeholder="012345678901234567890:abcdefg"
            />
            <p className="text-xs text-text-muted mt-2">
              Required for Google Programmable Search requests. Use the Search engine ID from your Programmable Search Engine control panel.
            </p>
          </div>
        )}

        {mode === "bulk" && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-text-muted">One key per line. Format: <code>name|apiKey</code> or just <code>apiKey</code> (auto-named by index).</p>
            <textarea
              className="w-full rounded border border-accent/30 bg-sidebar p-2 text-sm font-mono resize-y min-h-[140px] focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder={BULK_PLACEHOLDER}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
            />
            {bulkResult && (
              <div className={`text-sm font-medium ${bulkResult.failed > 0 ? "text-yellow-400" : "text-green-400"}`}>
                ✓ {bulkResult.success} added{bulkResult.failed > 0 ? `, ✗ ${bulkResult.failed} failed` : ""}
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={handleBulkSubmit} fullWidth disabled={saving || !bulkText.trim() || !hasRequiredGooglePseCx}>
                {saving ? "Adding..." : "Add All Keys"}
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth>Cancel</Button>
            </div>
          </div>
        )}

        {mode === "single" && (<>
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={isOllamaLocal ? "Ollama Local" : "Production Key"}
        />
        {supportsLocalBaseUrl && (
          <div className="flex gap-2">
            <Input
              label="Base URL"
              value={formData.localBaseUrl}
              onChange={(e) => setFormData({ ...formData, localBaseUrl: e.target.value })}
              placeholder={providerInfo.defaultBaseUrl}
              className="flex-1"
            />
            <div className="pt-6">
              <Button onClick={handleValidate} disabled={validating || saving} variant="secondary">
                {validating ? "Checking..." : "Check"}
              </Button>
            </div>
          </div>
        )}
        {!isOllamaLocal && (
          <div className="flex gap-2">
            <Input
              label={credentialLabel}
              type={isCookie ? "text" : "password"}
              value={formData.apiKey}
              onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
              placeholder={credentialPlaceholder}
              className="flex-1"
            />
            <div className="pt-6">
              <Button onClick={handleValidate} disabled={((!formData.apiKey && !isNoAuthProvider) || !hasRequiredGooglePseCx || validating || saving)} variant="secondary">
                {validating ? "Checking..." : "Check"}
              </Button>
            </div>
          </div>
        )}
        {isNoAuthProvider && (
          <p className="text-xs text-text-muted">
            API key is optional for this local OpenAI-compatible provider.
          </p>
        )}
        {isXaiApiKey && (
          <p className="text-xs text-text-muted">
            Use a direct xAI API key from console.x.ai. This is separate from Grok Build OAuth.
          </p>
        )}
        {isCookie && authHint && (
          <p className="text-xs text-text-muted">
            {authHint}
            {website && (
              <>
                {" "}
                <a href={website} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                  Open {website.replace(/^https?:\/\//, "")}
                </a>
              </>
            )}
          </p>
        )}
        {providerRegions && (
          <Select
            label="Region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            options={providerRegions.map((r) => ({ value: r.id, label: r.label }))}
          />
        )}
        {isCompatible && (
          <Input
            label="Default Model"
            value={formData.defaultModel}
            onChange={(e) => setFormData({ ...formData, defaultModel: e.target.value })}
            placeholder={isAnthropic ? "claude-3-5-sonnet-latest" : "gpt-4o-mini"}
          />
        )}
        {supportsLocalBaseUrl && (
          <p className="text-xs text-text-muted">
            Leave blank to use <code>{providerInfo.defaultBaseUrl}</code>. For another local host, enter the full OpenAI-compatible base URL.
          </p>
        )}
        {validationResult && (
          <Badge variant={validationResult === "success" ? "success" : "error"}>
            {validationResult === "success" ? "Valid" : "Invalid"}
          </Badge>
        )}
        {error && (
          <p className="text-xs text-red-500 break-words">{error}</p>
        )}
        {isCompatible && (
          <p className="text-xs text-text-muted">
            Enter the model ID exactly as your compatible endpoint expects it. This model will be saved as the connection default.
          </p>
        )}
        {requiresAccountId && (
          <div className="bg-sidebar/50 p-4 rounded-lg border border-accent/20">
            <h3 className="font-semibold mb-3 text-sm">{accountIdProviderLabel}</h3>
            <Input
              label="Account ID"
              value={cloudflareData.accountId}
              onChange={(e) => setCloudflareData({ ...cloudflareData, accountId: e.target.value })}
              placeholder={provider === "snowflake" ? "org-account" : "abc123def456..."}
            />
            <p className="text-xs text-text-muted mt-2">
              {provider === "snowflake"
                ? "Find your account identifier in the Snowflake URL, e.g. https://org-account.snowflakecomputing.com"
                : "Find your Account ID in the right sidebar of "}
              {provider === "snowflake" ? null : (
                <a href="https://dash.cloudflare.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">dash.cloudflare.com</a>
              )}
            </p>
          </div>
        )}
        {isAzure && (
          <div className="bg-sidebar/50 p-4 rounded-lg border border-accent/20">
            <h3 className="font-semibold mb-3 text-sm">Azure OpenAI Configuration</h3>
            <div className="flex flex-col gap-3">
              <Input
                label="Azure Endpoint"
                value={azureData.azureEndpoint}
                onChange={(e) => setAzureData({ ...azureData, azureEndpoint: e.target.value })}
                placeholder="https://your-resource.openai.azure.com"
              />
              <Input
                label="Deployment Name"
                value={azureData.deployment}
                onChange={(e) => setAzureData({ ...azureData, deployment: e.target.value })}
                placeholder="gpt-4"
              />
              <Input
                label="API Version"
                value={azureData.apiVersion}
                onChange={(e) => setAzureData({ ...azureData, apiVersion: e.target.value })}
                placeholder="2024-10-01-preview"
              />
              <Input
                label="Organization"
                value={azureData.organization}
                onChange={(e) => setAzureData({ ...azureData, organization: e.target.value })}
                placeholder="Organization ID"
              />
            </div>
          </div>
        )}

        <Input
          label="Priority"
          type="number"
          value={formData.priority}
          onChange={(e) => setFormData({ ...formData, priority: Number.parseInt(e.target.value) || 1 })}
        />

        <Select
          label="Proxy Pool"
          value={formData.proxyPoolId}
          onChange={(e) => setFormData({ ...formData, proxyPoolId: e.target.value })}
          options={[
            { value: NONE_PROXY_POOL_VALUE, label: "None" },
            ...(proxyPools || []).map((pool) => ({ value: pool.id, label: pool.name })),
          ]}
          placeholder="None"
        />

        {(proxyPools || []).length === 0 && (
          <p className="text-xs text-text-muted">
            No active proxy pools available. Create one in Proxy Pools page first.
          </p>
        )}

        <p className="text-xs text-text-muted">
          Legacy manual proxy fields are still accepted by API for backward compatibility.
        </p>

        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={saving || (!isOllamaLocal && (!formData.name || (!isNoAuthProvider && !isFreeNoAuthProvider && !formData.apiKey))) || (isCompatible && !formData.defaultModel.trim()) || (isAzure && (!azureData.azureEndpoint || !azureData.deployment || !azureData.organization)) || (requiresAccountId && !cloudflareData.accountId) || !hasRequiredGooglePseCx}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
        </>)}
      </div>
    </Modal>
  );
}

AddApiKeyModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.string,
  providerName: PropTypes.string,
  isCompatible: PropTypes.bool,
  isAnthropic: PropTypes.bool,
  authType: PropTypes.string,
  authHint: PropTypes.string,
  website: PropTypes.string,
  proxyPools: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
  })),
  existingConnectionNames: PropTypes.arrayOf(PropTypes.string),
  existingConnectionCount: PropTypes.number,
  error: PropTypes.string,
  onSave: PropTypes.func.isRequired,
  onBulkDone: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
