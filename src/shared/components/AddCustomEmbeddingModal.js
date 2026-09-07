"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/ui/components/Modal.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import { translate } from "@/i18n/runtime";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

// Dual-mode modal: edit when `node` provided, add otherwise
export default function AddCustomEmbeddingModal({ isOpen, onClose, onCreated, onSaved, node }) {
  const isEdit = !!node;
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    baseUrl: DEFAULT_BASE_URL,
  });
  const [submitting, setSubmitting] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [checkModelId, setCheckModelId] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setValidationResult(null);
    setCheckKey("");
    setCheckModelId("");
    if (isEdit) {
      setFormData({
        name: node.name || "",
        prefix: node.prefix || "",
        baseUrl: node.baseUrl || DEFAULT_BASE_URL,
      });
    } else {
      setFormData({ name: "", prefix: "", baseUrl: DEFAULT_BASE_URL });
    }
  }, [isOpen, isEdit, node]);

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    setSubmitting(true);
    try {
      const url = isEdit ? `/api/provider-nodes/${node.id}` : "/api/provider-nodes";
      const method = isEdit ? "PUT" : "POST";
      const payload = {
        name: formData.name,
        prefix: formData.prefix,
        baseUrl: formData.baseUrl,
      };
      if (!isEdit) payload.type = "custom-embedding";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        if (isEdit) onSaved?.(data.node);
        else onCreated?.(data.node);
      }
    } catch (error) {
      console.log("Error saving custom embedding node:", error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/provider-nodes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: formData.baseUrl,
          apiKey: checkKey,
          type: "custom-embedding",
          modelId: checkModelId.trim() || undefined,
        }),
      });
      const data = await res.json();
      setValidationResult(data);
    } catch {
      setValidationResult({ valid: false, error: "Network error" });
    } finally {
      setValidating(false);
    }
  };

  const renderValidationResult = () => {
    if (!validationResult) return null;
    const { valid, error, dimensions } = validationResult;
    if (valid) {
      return <div className="flex items-center gap-2"><Badge tone="success">Valid</Badge>{dimensions ? <span className="text-xs text-dd-muted">{dimensions} dims</span> : null}</div>;
    }
    return <div className="flex flex-col gap-1"><Badge tone="danger">Invalid</Badge>{error ? <span className="text-xs text-dd-danger">{error}</span> : null}</div>;
  };
  return (
    <Modal open={isOpen} title={isEdit ? translate("Edit Custom Embedding") : translate("Add Custom Embedding")} subtitle="Configure an OpenAI-compatible embedding endpoint." onClose={onClose} size="md" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={handleSubmit} loading={submitting} disabled={!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()}>{isEdit ? "Save" : "Create"}</Button></>}>
      <div className="flex flex-col gap-5">
        <Input label="Name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Voyage AI" hint="Required. A friendly label for this embedding provider." required />
        <Input label="Prefix" value={formData.prefix} onChange={(e) => setFormData({ ...formData, prefix: e.target.value })} placeholder="voyage" hint="Required. Used as provider prefix for model IDs, for example voyage/voyage-3." required />
        <Input label="Base URL" value={formData.baseUrl} onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })} placeholder="https://api.voyageai.com/v1" hint="Most embedding APIs are OpenAI-compatible." required />
        <section aria-labelledby="embedding-check-title" className="flex flex-col gap-4 rounded-dd-lg border border-dd-border-subtle bg-dd-surface-2 p-4">
          <div><h3 id="embedding-check-title" className="text-[13px] font-semibold text-dd-text">Validate endpoint</h3><p className="mt-1 text-xs text-dd-muted">Sends a test embeddings request without saving this provider.</p></div>
          <Input label="API Key" type="password" value={checkKey} onChange={(e) => setCheckKey(e.target.value)} />
          <Input label="Model ID" value={checkModelId} onChange={(e) => setCheckModelId(e.target.value)} placeholder="voyage-3" hint="Required for validation." />
          <div className="flex flex-wrap items-center gap-3"><Button variant="secondary" icon="fact_check" onClick={handleValidate} loading={validating} disabled={!checkKey || !checkModelId.trim() || !formData.baseUrl.trim()}>Check</Button>{renderValidationResult()}</div>
        </section>
      </div>
    </Modal>
  );
}

AddCustomEmbeddingModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func,
  onSaved: PropTypes.func,
  node: PropTypes['shape']({
    id: PropTypes.string,
    name: PropTypes.string,
    prefix: PropTypes.string,
    baseUrl: PropTypes.string,
  }),
};
