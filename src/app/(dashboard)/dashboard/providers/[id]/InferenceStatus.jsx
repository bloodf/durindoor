export default function InferenceStatus({ status, testing }) {
  const label = testing ? "Inference test running" : {
    ok: "Inference passed in this session",
    error: "Inference failed in this session",
    skipped: "Inference skipped in this session",
    testing: "Inference test running",
  }[status] || "Inference not tested";

  return <span role="status" className="text-xs text-dd-muted">{label}</span>;
}
