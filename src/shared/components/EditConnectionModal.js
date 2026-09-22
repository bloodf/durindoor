"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/ui/components/Modal.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import Field from "@/shared/ui/components/Field.jsx";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider, AI_PROVIDERS } from "@/shared/constants/providers";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import { requiresProviderAccountId } from "@/lib/providerAccountIds";
import {
  buildGooglePseProviderSpecificData,
  isGooglePseProvider,
  normalizeGooglePseCx } from
"@/shared/utils/googlePseProviderSpecificData";
import { buildAwsConnectionEdit } from "@/shared/utils/awsConnectionEdit";

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
  const [awsData, setAwsData] = useState({ profile: "", accessKeyId: "", sessionToken: "" });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [aiCreditLimit, setAiCreditLimit] = useState("");

  useEffect(() => {
    if (connection) {
      setFormData({
        name: connection.name || "",
        priority: connection.priority || 1,
        apiKey: "",
        openaiStoreEnabled: connection.providerSpecificData?.openaiStoreEnabled === true
      });
      setAiCreditLimit(connection.providerSpecificData?.aiCreditLimit?.toString() ?? "");
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
      // Saved AWS fields are loaded so the edit form shows which mode is active. The session
      // token is a secret the API never returns, so it always starts blank.
      setAwsData({
        profile: connection.providerSpecificData?.profile || "",
        accessKeyId: connection.providerSpecificData?.accessKeyId || "",
        sessionToken: ""
      });
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
  const isGithub = connection?.provider === "github";
  const invalidCreditLimit = isGithub && aiCreditLimit !== "" &&
  (!Number.isFinite(Number(aiCreditLimit)) || Number(aiCreditLimit) < 0);
  const isCompatible = connection ?
  isOpenAICompatibleProvider(connection.provider) || isAnthropicCompatibleProvider(connection.provider) :
  false;
  const isResponsesConnection = connection?.provider === "openai" ||
  connection?.provider?.startsWith("openai-compatible-responses-");

  const providerRegions = connection ? AI_PROVIDERS?.[connection.provider]?.regions || null : null;
  const usesAwsCredentialForm = AI_PROVIDERS?.[connection?.provider]?.credentialForm === "aws";
  // A Check result only vouches for the credentials it was run with, so any edit invalidates it.
  const editAwsData = (patch) => {
    setAwsData({ ...awsData, ...patch });
    setValidationResult(null);
  };
  const buildAwsEdit = () => buildAwsConnectionEdit({
    savedData: connection?.providerSpecificData,
    awsData,
    apiKey: formData.apiKey,
    region
  });
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
    if (usesAwsCredentialForm) {
      return buildAwsEdit().providerSpecificData;
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
          sessionToken: awsData.sessionToken.trim() || undefined,
          connectionId: connection.id,
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
    if (!connection || invalidCreditLimit) return;
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
                sessionToken: awsData.sessionToken.trim() || undefined,
                connectionId: connection.id,
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
        // An AWS edit that swaps credentials also clears the profile, so saving a key that failed
        // the check would drop a working SSO setup for a bad paste.
        if (!isValid && usesAwsCredentialForm) return;
        if (isValid) {
          updates.testStatus = "active";
          updates.lastError = null;
          updates.lastErrorAt = null;
        }
      }

      // Merge rather than replace: buildProviderSpecificData owns the
      // region/proxy/fingerprint fields and must not be clobbered here.
      if (isGithub) {
        updates.providerSpecificData = {
          ...providerSpecificData,
          aiCreditLimit: aiCreditLimit === "" ? null : Number(aiCreditLimit),
        };
      } else if (providerSpecificData) {
        updates.providerSpecificData = providerSpecificData;
      }

      if (usesAwsCredentialForm) {
        const { sessionToken } = buildAwsEdit();
        if (sessionToken !== undefined) updates.sessionToken = sessionToken;
      }

      await onSave(updates);
    } finally {
      setSaving(false);
    }
  };

  if (!connection) return null;

  return (
    <Modal open={isOpen} title="Edit Connection" subtitle="Update connection settings and validate new credentials before saving." onClose={onClose} size="md" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={handleSubmit} loading={saving} disabled={invalidCreditLimit || !hasRequiredGooglePseCx || requiresAccountId && !cloudflareData.accountId.trim()}>Save</Button></>}>
      <div className="flex flex-col gap-5">
        <Input label="Name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder={isOAuth ? "Account name" : "Production Key"} />
        {isOAuth && connection.email ? <section aria-label="Connected account" className="rounded-dd-lg border border-dd-border-subtle bg-dd-surface-2 p-4"><p className="text-xs text-dd-muted">Email</p><p className="mt-1 text-[13px] font-medium text-dd-text">{connection.email}</p></section> : null}
        <Input label="Priority" type="number" value={formData.priority} onChange={(e) => setFormData({ ...formData, priority: Number.parseInt(e.target.value, 10) || 1 })} />
        {isGithub ? <Input label="AI Credits limit per billing period" type="number" min="0" step="any" value={aiCreditLimit} onChange={(e) => setAiCreditLimit(e.target.value)} placeholder="No local limit" error={invalidCreditLimit ? "Enter a non-negative number." : undefined} hint="Blank disables the limit; 0 blocks all requests. Checks GitHub-reported credit usage through a short-lived cache, and blocks when usage cannot be verified. Cached readings, GitHub reporting delays and in-flight requests can all overshoot this cutoff, so it is not a guaranteed spending ceiling. Applies only to this connection's traffic." /> : null}
        {!isOAuth ? <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end"><div className="min-w-0 flex-1"><Input label="API Key" type="password" value={formData.apiKey} onChange={(e) => { setFormData({ ...formData, apiKey: e.target.value }); setValidationResult(null); }} placeholder="Enter new API key" hint="Leave blank to keep current API key." /></div><Button variant="secondary" icon="fact_check" onClick={handleValidate} loading={validating} disabled={!formData.apiKey || !hasRequiredGooglePseCx || requiresAccountId && !cloudflareData.accountId.trim() || saving}>Check</Button></div>
          {validationResult ? <Badge tone={validationResult === "success" ? "success" : "danger"}>{validationResult === "success" ? "Valid" : "Invalid"}</Badge> : null}
        </> : null}
        {isGooglePse ? <section className="rounded-dd-lg border border-dd-border-subtle bg-dd-surface-2 p-4"><h3 className="mb-3 text-[13px] font-semibold text-dd-text">Google Programmable Search</h3><Input label="Search Engine ID (cx)" value={googlePseData.cx} onChange={(e) => setGooglePseData({ cx: e.target.value })} placeholder="012345678901234567890:abcdefg" hint="Required for Google Programmable Search requests." /></section> : null}
        {isAzure ? <section className="rounded-dd-lg border border-dd-border-subtle bg-dd-surface-2 p-4"><h3 className="mb-3 text-[13px] font-semibold text-dd-text">Azure OpenAI Configuration</h3><div className="flex flex-col gap-3"><Input label="Azure Endpoint" value={azureData.azureEndpoint} onChange={(e) => setAzureData({ ...azureData, azureEndpoint: e.target.value })} placeholder="https://your-resource.openai.azure.com" hint="Your Azure OpenAI resource endpoint URL" /><Input label="Deployment Name" value={azureData.deployment} onChange={(e) => setAzureData({ ...azureData, deployment: e.target.value })} placeholder="gpt-4" hint="Deployment name in Azure resource" /><Input label="API Version" value={azureData.apiVersion} onChange={(e) => setAzureData({ ...azureData, apiVersion: e.target.value })} placeholder="2024-10-01-preview" hint="Azure OpenAI API version to use" /><Input label="Organization" value={azureData.organization} onChange={(e) => setAzureData({ ...azureData, organization: e.target.value })} placeholder="Organization ID" hint="Required for billing" /></div></section> : null}
        {isCodexOAuth ? <Field label="OAuth fingerprint mode"><Select value={codexFingerprintMode} onChange={setCodexFingerprintMode} options={[{ value: "off", label: "Off — preserve client identity" }, { value: "device", label: "Device — stable installation" }, { value: "session", label: "Session — stable account session (recommended)" }, { value: "full", label: "Full — stable account thread" }]} aria-label="OAuth fingerprint mode" /></Field> : null}
        {providerRegions ? <Field label="Region"><Select value={region} onChange={setRegion} options={providerRegions.map((r) => ({ value: r.id, label: r.label }))} aria-label="Region" /></Field> : null}
        {usesAwsCredentialForm ? <section className="rounded-dd-lg border border-dd-border-subtle bg-dd-surface-2 p-4"><h3 className="mb-3 text-[13px] font-semibold text-dd-text">AWS Credentials</h3><div className="flex flex-col gap-3"><Input label="AWS Profile (SSO)" value={awsData.profile} onChange={(e) => editAwsData({ profile: e.target.value })} placeholder="my-sso-profile" hint={formData.apiKey && awsData.profile.trim() ? "Saving with a new API key clears this profile." : "Takes precedence over any key. Clear it to use static keys or a Bedrock API key."} /><Input label="Access Key ID (static AWS keys only)" value={awsData.accessKeyId} onChange={(e) => editAwsData({ accessKeyId: e.target.value })} placeholder="AKIA..." hint="Put the secret access key in the API Key field. Clear this to use a Bedrock API key." /><Input label="Session Token (temporary ASIA... keys only)" type="password" autoComplete="off" value={awsData.sessionToken} onChange={(e) => editAwsData({ sessionToken: e.target.value })} placeholder="Enter new session token" hint="Leave blank to keep the current token. Changing the access key id replaces it." /></div></section> : null}
        {isResponsesConnection ? <Toggle checked={formData.openaiStoreEnabled === true} onChange={(openaiStoreEnabled) => setFormData({ ...formData, openaiStoreEnabled })} label="OpenAI Responses store" description="Allow this connection to retain Responses API state for continuation." /> : null}
        {requiresAccountId ? <section className="rounded-dd-lg border border-dd-border-subtle bg-dd-surface-2 p-4"><h3 className="mb-3 text-[13px] font-semibold text-dd-text">{accountIdProviderLabel}</h3><Input label="Account ID" value={cloudflareData.accountId} onChange={(e) => setCloudflareData({ accountId: e.target.value })} placeholder={connection?.provider === "snowflake" ? "org-account" : "abc123def456..."} hint={connection?.provider === "snowflake" ? "Snowflake account identifier, for example org-account" : "Find Account ID in right sidebar of dash.cloudflare.com"} /></section> : null}
        {!isCompatible && !isAzure && !requiresAccountId ? <div className="flex flex-wrap items-center gap-3"><Button variant="secondary" icon="network_check" onClick={handleTest} loading={testing}>Test Connection</Button>{testResult ? <Badge tone={testResult === "success" ? "success" : "danger"}>{testResult === "success" ? "Valid" : "Failed"}</Badge> : null}</div> : null}
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