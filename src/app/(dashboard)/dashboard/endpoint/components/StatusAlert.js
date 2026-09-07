"use client";

const TONE_CLASS = {
  success: "border-dd-success bg-dd-success/10 text-dd-success",
  warning: "border-dd-warning bg-dd-warning/10 text-dd-warning",
  info: "border-dd-info bg-dd-info/10 text-dd-info",
  error: "border-dd-danger bg-dd-danger/10 text-dd-danger",
};

/** Reusable status alert */
export default function StatusAlert({ status, className = "" }) {
  const renderMessage = (msg) => {
    const parts = msg.split(/(https?:\/\/[^\s]+)/g);
    return parts.map((part, i) =>
      /^https?:\/\//.test(part)
        ? <a key={i} href={part} target="_blank" rel="noreferrer" className="underline font-medium">{part}</a>
        : part
    );
  };
  const tone = TONE_CLASS[status.type] ?? TONE_CLASS.error;

  return (
    <div
      role={status.type === "error" ? "alert" : "status"}
      className={`rounded-dd border px-3 py-2 text-[13px] ${className} ${tone}`}
    >
      {renderMessage(status.message)}
    </div>
  );
}
