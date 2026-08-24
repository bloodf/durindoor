"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/components/Modal";
import Input from "@/shared/components/Input";
import Button from "@/shared/components/Button";
import Badge from "@/shared/components/Badge";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider, AI_PROVIDERS } from "@/shared/constants/providers";
import Toggle from "@/shared/components/Toggle";
import Select from "@/shared/components/Select";
import { requiresProviderAccountId } from "@/lib/providerAccountIds";
import {
  buildGooglePseProviderSpecificData,
  isGooglePseProvider,
  normalizeGooglePseCx } from
"@/shared/utils/googlePseProviderSpecificData";

export default function EditConnectionModal({ isOpen, connection, proxyPools, onSave, onClose }) {
  const [formData, setFormData] = useState({
    name: "",
    priority: 1,
    apiKey: ""
  });
  const [azureData, setAzureData] = useState({
    azureEndpoint: "",
    apiVersion: "2024-10-01-preview",
    deployment: "",
    organization: ""
  });
  const [cloudflareData, setCloudflareData] = useState({ accountId: "" });
  const [googlePseData, setGooglePseData] = useState({ cx: "" });
  const [codexFingerprintMode, setCodexFingerprintMode] = useState("session");
  const [region, setRegion] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (connection) {
      setFormData({
        name: connection.name || "",
        priority: connection.priority || 1,
        apiKey: "",
        openaiStoreEnabled: connection.providerSpecificData?.openaiStoreEnabled === true
      });
      // Load Azure-specific data if present
      if (connection.provider === "azure" && connection.providerSpecificData) {
        setAzureData({
          azureEndpoint: connection.providerSpecificData.azureEndpoint || "",
          apiVersion: connection.providerSpecificData.apiVersion || "2024-10-01-preview",
          deployment: connection.providerSpecificData.deployment || "",
          organization: connection.providerSpecificData.organization || ""
        });
      }
      // Always reset when switching connections so a legacy row with missing
      // metadata cannot inherit another tenant's account ID from component state.
      setCloudflareData({
        accountId: requiresProviderAccountId(connection.provider) ?
        connection.providerSpecificData?.accountId || "" :
        ""
      });
      if (connection.provider === "google-pse") {
        setGooglePseData({ cx: connection.providerSpecificData?.cx || "" });
      }
      // Always reset when switching connections so a stale mode cannot
      // leak into a different (or non-OAuth) provider's request headers.
      setCodexFingerprintMode(
        connection.provider === "codex" &&
        ["off", "device", "session", "full"].includes(connection.providerSpecificData?.codexFingerprintMode) ?
        connection.providerSpecificData.codexFingerprintMode :
        "session"
      );
      // Load region for providers that support it (e.g. xiaomi-tokenplan)
      const providerCfg = AI_PROVIDERS?.[connection.provider];
      if (providerCfg?.regions) {
        const savedRegion = connection.providerSpecificData?.region || providerCfg.defaultRegion || providerCfg.regions[0]?.id || "";
        setRegion(savedRegion);
      }
      setTestResult(null);
      setValidationResult(null);
    }
  }, [connection]);

  const isOAuth = connection?.authType === "oauth";
  const isAzure = connection?.provider === "azure";
  const requiresAccountId = requiresProviderAccountId(connection?.provider);
  const accountIdProviderLabel = connection?.provider === "snowflake" ? "Snowflake Cortex" : "Cloudflare Workers AI";
  const isGooglePse = isGooglePseProvider(connection?.provider);
  const isCodexOAuth = connection?.provider === "codex" && isOAuth;
  const isCompatible = connection ?
  isOpenAICompatibleProvider(connection.provider) || isAnthropicCompatibleProvider(connection.provider) :
  false;
  const isResponsesConnection = connection?.provider === "openai" ||
  connection?.provider?.startsWith("openai-compatible-responses-");

  const providerRegions = connection ? AI_PROVIDERS?.[connection.provider]?.regions || null : null;
  // Build providerSpecificData for region-aware providers
  const buildRegionSpecificData = () => {
    if (providerRegions && region) return { ...(connection?.providerSpecificData || {}), region };
    return undefined;
  };

  const buildProviderSpecificData = () => {
    if (isAzure) {
      return {
        azureEndpoint: azureData.azureEndpoint,
        apiVersion: azureData.apiVersion,
        deployment: azureData.deployment,
        organization: azureData.organization
      };
    }
    if (requiresAccountId) {
      return { accountId: cloudflareData.accountId.trim() };
    }
    if (isGooglePse) {
      return buildGooglePseProviderSpecificData(googlePseData.cx, connection?.providerSpecificData);
    }
    if (isCodexOAuth) {
      return { ...connection.providerSpecificData, codexFingerprintMode };
    }
    if (providerRegions) {
      return buildRegionSpecificData();
    }
    if (isResponsesConnection) {
      return {
        ...(connection?.providerSpecificData || {}),
        openaiStoreEnabled: formData.openaiStoreEnabled === true
      };
    }
    return undefined;
  };
  const hasRequiredGooglePseCx = !isGooglePse || !!normalizeGooglePseCx(googlePseData.cx);

  const handleTest = async () => {
    if (!connection?.provider) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/providers/${connection.id}/test`, { method: "POST" });
      const data = await res.json();
      setTestResult(data.valid ? "success" : "failed");
    } catch {
      setTestResult("failed");
    } finally {
      setTesting(false);
    }
  };

  const handleValidate = async () => {
    if (!connection?.provider || !formData.apiKey) return;
    if (!hasRequiredGooglePseCx) return;
    if (requiresAccountId && !cloudflareData.accountId.trim()) return;
    setValidating(true);
    setValidationResult(null);
    const providerSpecificData = buildProviderSpecificData();
    try {
      const res = await fetch("/api/providers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: connection.provider,
          apiKey: formData.apiKey,
          ...(providerSpecificData ? { providerSpecificData } : null)
        })
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
    if (!connection) return;
    if (!hasRequiredGooglePseCx) return;
    if (requiresAccountId && !cloudflareData.accountId.trim()) return;
    setSaving(true);
    try {
      const providerSpecificData = buildProviderSpecificData();
      const updates = {
        name: formData.name,
        priority: formData.priority
      };
      if (!isOAuth && formData.apiKey) {
        updates.apiKey = formData.apiKey;
        let isValid = validationResult === "success";
        if (!isValid) {
          try {
            setValidating(true);
            setValidationResult(null);
            const res = await fetch("/api/providers/validate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                provider: connection.provider,
                apiKey: formData.apiKey,
                ...(providerSpecificData ? { providerSpecificData } : null)
              })
            });
            const data = await res.json();
            isValid = !!data.valid;
            setValidationResult(isValid ? "success" : "failed");
          } catch {
            setValidationResult("failed");
          } finally {
            setValidating(false);
          }
        }
        if (isValid) {
          updates.testStatus = "active";
          updates.lastError = null;
          updates.lastErrorAt = null;
        }
      }

      if (providerSpecificData) {
        updates.providerSpecificData = providerSpecificData;
      }

      await onSave(updates);
    } finally {
      setSaving(false);
    }
  };

  if (!connection) return null;

  return (
    <Modal isOpen={isOpen} title="Edit Connection" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={isOAuth ? "Account name" : "Production Key"} />
        
        {isOAuth && connection.email &&
        <div className="bg-sidebar/50 p-3 rounded-lg">
            <p className="text-sm text-text-muted mb-1">Email</p>
            <p className="font-medium">{connection.email}</p>
          </div>
        }
        <Input
          label="Priority"
          type="number"
          value={formData.priority}
          onChange={(e) => setFormData({ ...formData, priority: Number.parseInt(e.target.value, 10) || 1 })} />
        

        {!isOAuth &&
        <>
            <div className="flex gap-2">
              <Input
              label="API Key"
              type="password"
              value={formData.apiKey}
              onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
              placeholder="Enter new API key"
              hint="Leave blank to keep the current API key."
              className="flex-1" />
            
              <div className="pt-6">
                <Button onClick={handleValidate} disabled={!formData.apiKey || !hasRequiredGooglePseCx || requiresAccountId && !cloudflareData.accountId.trim() || validating || saving} variant="secondary">
                  {validating ? "Checking..." : "Check"}
                </Button>
              </div>
            </div>
            {validationResult &&
          <Badge variant={validationResult === "success" ? "success" : "error"}>
                {validationResult === "success" ? "Valid" : "Invalid"}
              </Badge>
          }
          </>
        }

        {isGooglePse &&
        <div className="bg-sidebar/50 p-4 rounded-lg border border-accent/20">
            <h3 className="font-semibold mb-3 text-sm">Google Programmable Search</h3>
            <Input
            label="Search Engine ID (cx)"
            value={googlePseData.cx}
            onChange={(e) => setGooglePseData({ cx: e.target.value })}
            placeholder="012345678901234567890:abcdefg"
            hint="Required for Google Programmable Search requests." />
          
          </div>
        }

        {isAzure &&
        <div className="bg-sidebar/50 p-4 rounded-lg border border-accent/20">
            <h3 className="font-semibold mb-3 text-sm">Azure OpenAI Configuration</h3>
            <div className="flex flex-col gap-3">
              <Input
              label="Azure Endpoint"
              value={azureData.azureEndpoint}
              onChange={(e) => setAzureData({ ...azureData, azureEndpoint: e.target.value })}
              placeholder="https://your-resource.openai.azure.com"
              hint="Your Azure OpenAI resource endpoint URL" />
            
              <Input
              label="Deployment Name"
              value={azureData.deployment}
              onChange={(e) => setAzureData({ ...azureData, deployment: e.target.value })}
              placeholder="gpt-4"
              hint="The deployment name in your Azure resource" />
            
              <Input
              label="API Version"
              value={azureData.apiVersion}
              onChange={(e) => setAzureData({ ...azureData, apiVersion: e.target.value })}
              placeholder="2024-10-01-preview"
              hint="Azure OpenAI API version to use" />
            
              <Input
              label="Organization"
              value={azureData.organization}
              onChange={(e) => setAzureData({ ...azureData, organization: e.target.value })}
              placeholder="Organization ID"
              hint="Required for billing" />
            
            </div>
          </div>
        }
        {isCodexOAuth &&
        <Select
          label="OAuth fingerprint mode"
          value={codexFingerprintMode}
          onChange={(e) => setCodexFingerprintMode(e.target.value)}
          options={[
          { value: "off", label: "Off — preserve client identity" },
          { value: "device", label: "Device — stable installation" },
          { value: "session", label: "Session — stable account session (recommended)" },
          { value: "full", label: "Full — stable account thread" }]
          } />

        }

        {providerRegions &&
        <Select
          label="Region"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          options={providerRegions.map((r) => ({ value: r.id, label: r.label }))} />

        }

        {isResponsesConnection &&
        <Toggle
          checked={formData.openaiStoreEnabled === true}
          onChange={(openaiStoreEnabled) => setFormData({ ...formData, openaiStoreEnabled })}
          label="OpenAI Responses store"
          description="Allow this connection to retain Responses API state for continuation." />

        }

        {requiresAccountId &&
        <div className="bg-sidebar/50 p-4 rounded-lg border border-accent/20">
            <h3 className="font-semibold mb-3 text-sm">{accountIdProviderLabel}</h3>
            <Input
            label="Account ID"
            value={cloudflareData.accountId}
            onChange={(e) => setCloudflareData({ ...cloudflareData, accountId: e.target.value })}
            placeholder={connection?.provider === "snowflake" ? "org-account" : "abc123def456..."}
            hint={connection?.provider === "snowflake" ? "Your Snowflake account identifier (e.g. org-account)" : "Find your Account ID in the right sidebar of dash.cloudflare.com"} />
          
          </div>
        }

        {!isCompatible && !isAzure && !requiresAccountId &&
        <div className="flex items-center gap-3">
            <Button onClick={handleTest} variant="secondary" disabled={testing}>
              {testing ? "Testing..." : "Test Connection"}
            </Button>
            {testResult &&
          <Badge variant={testResult === "success" ? "success" : "error"}>
                {testResult === "success" ? "Valid" : "Failed"}
              </Badge>
          }
          </div>
        }

        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={saving || !hasRequiredGooglePseCx || requiresAccountId && !cloudflareData.accountId.trim()}>{saving ? "Saving..." : "Save"}</Button>
          <Button onClick={onClose} variant="ghost" fullWidth>Cancel</Button>
        </div>
      </div>
    </Modal>);

}

EditConnectionModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  connection: PropTypes['shape']({
    id: PropTypes.string,
    name: PropTypes.string,
    email: PropTypes.string,
    priority: PropTypes.number,
    authType: PropTypes.string,
    provider: PropTypes.string,
    providerSpecificData: PropTypes.object
  }),
  proxyPools: PropTypes.arrayOf(PropTypes['shape']({
    id: PropTypes.string,
    name: PropTypes.string
  })),
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired
};