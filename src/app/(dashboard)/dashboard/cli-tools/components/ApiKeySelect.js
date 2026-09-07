"use client";

import Input from "@/shared/ui/components/Input.jsx";

export default function ApiKeySelect({ value, onChange, apiKeys = [], cloudEnabled = false, className = "" }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <Input
        aria-label="API key"
        type="password"
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        placeholder={cloudEnabled ? "Paste the API key secret" : "sk_durindoor or a saved secret"}
        size="sm"
      />
      {apiKeys.length > 0 ? (
        <p className="text-[11px] text-dd-muted">
          Managed keys: {apiKeys.map((key) => `${key.name || "Key"} (${key.maskedKey || "***"})`).join(", ")}. Stored secrets cannot be retrieved.
        </p>
      ) : null}
    </div>
  );
}
