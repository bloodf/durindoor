export async function updateCompatibleProviderNode({ providerId, formData, onSuccess }) {
  const res = await fetch(`/api/provider-nodes/${providerId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(formData),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to update provider node");
  }
  const data = await res.json();
  await onSuccess(data.node);
}
