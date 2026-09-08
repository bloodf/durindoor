"use client";

export default function ApiKeySelect({ value, onChange, apiKeys = [], cloudEnabled = false, className = "" }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <input
        type="password"
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        placeholder={cloudEnabled ? "Paste the API key secret" : "sk_durindoor or a saved secret"}
        className="w-full min-w-0 px-2 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
      />
      {apiKeys.length > 0 && (
        <p className="text-[11px] text-text-muted">
          Managed keys: {apiKeys.map((key) => `${key.name || "Key"} (${key.maskedKey || "***"})`).join(", ")}. Stored secrets cannot be retrieved.
        </p>
      )}
    </div>
  );
}
