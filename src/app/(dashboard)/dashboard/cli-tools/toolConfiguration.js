import useSettingsStore from "@/store/settingsStore";
import { isBoolean, isObject } from "@/shared/utils/typeChecks.js";

/** Discovery is one confirmed snapshot. Missing transport settings are unknown,
 * not evidence that a tool should be configured against a local endpoint. */
export async function loadToolConfiguration(request = fetch) {
  const [responses, settings] = await Promise.all([
    Promise.all(["/api/providers", "/api/tunnel/status", "/api/keys"].map((url) => request(url))),
    useSettingsStore.getState().fetchSettings(),
  ]);
  if (!settings || responses.some((res) => !res.ok)) throw new Error("Tool configuration could not be loaded. Retry to check connections and settings.");
  const [providers, tunnel, keys] = await Promise.all(responses.map((res) => res.json()));
  const transport = (value) => value != null && isObject(value) && (isBoolean(value.enabled) || isBoolean(value.settingsEnabled));
  if (!Array.isArray(providers?.connections) || !Array.isArray(keys?.keys) || !isBoolean(settings?.cloudEnabled) || !transport(tunnel?.tunnel) || !transport(tunnel?.tailscale)) {
    throw new Error("Tool configuration response is incomplete.");
  }
  return { providers, settings, tunnel, keys };
}
