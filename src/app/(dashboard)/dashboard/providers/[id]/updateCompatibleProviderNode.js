import api from "@/shared/utils/api";

export async function updateCompatibleProviderNode({ providerId, formData, onSuccess }) {
  let data;
  try {
    data = await api.put(`/api/provider-nodes/${providerId}`, formData, {
      headers: { "Content-Type": "application/json" },
      strictJson: true,
    });
  } catch (error) {
    if (Object.hasOwn(error, "body")) throw new Error(error.body?.error || "Failed to update provider node");
    throw error;
  }
  await onSuccess(data.node);
}
