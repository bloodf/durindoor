// Microsoft 365 Copilot image adapter: one Copilot chat turn draws the images, which are then
// downloaded from the Designer service. Ported from OmniRoute (MIT) m365ImageGeneration.ts at
// 5ffa68e83544; see open-sse/executors/copilot-m365-image-generation.js.
import { nowSec } from "./_base.js";
import { generateM365Images, m365OrientationForSize } from "../../executors/copilot-m365-image-generation.js";

export default {
  useExecutor: true,

  // Stubs required by the imageGenerationCore interface; unused with useExecutor.
  buildUrl: () => "",
  buildHeaders: () => ({}),
  buildBody: () => ({}),

  async executeViaExecutor(model, body, credentials, log, proxyOptions = null, signal = undefined, onCredentialsRefreshed = undefined) {
    const images = await generateM365Images({
      credentials,
      prompt: String(body.prompt),
      orientation: m365OrientationForSize(body.size),
      signal,
      proxyOptions,
      log,
      onCredentialsRefreshed
    });
    // One turn draws what Copilot decides; `n` caps what is returned, never what is requested.
    const n = Number.isInteger(Number(body.n)) && Number(body.n) > 0 ? Number(body.n) : 1;
    return {
      created: nowSec(),
      data: images.slice(0, n).map((image) => ({ b64_json: image.data.toString("base64"), revised_prompt: body.prompt }))
    };
  },

  normalize: (responseBody) => responseBody
};
