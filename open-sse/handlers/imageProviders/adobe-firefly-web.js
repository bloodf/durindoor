// Adobe Firefly consumer web UI: registered experimental image adapter.
// See docs/providers/adobe-firefly-web.md.
//
// The adapter runs the guarded browser flow in services/fireflyWebUi through
// the `.generate({ model, body, credentials, signal, log })` contract and
// returns `{ success, response, accounting }` or an error result that keeps
// `acceptedJob` when the submit may have been taken. It has no useExecutor
// path, which would drop that accepted job.
//
// Output is this gateway's own local synchronous b64_json body,
// `{ created, data: [{ b64_json, mime_type, output_format }] }`, built from
// the verified downloaded file. It is not an Adobe API response. An omitted
// response_format means b64_json; any other format is refused before launch.
import { runFireflyWebUiGeneration } from "../../services/fireflyWebUi/flow.js";
import { RESPONSE_FORMAT } from "../../services/fireflyWebUi/config.js";

const defaultDataDir = async () => (await import("../../../src/lib/dataDir.js")).DATA_DIR;

/** @param {object} [deps] - launcher, dataDir, journal, tmpRoot; see runFireflyWebUiGeneration */
export function createAdobeFireflyWebImageAdapter(deps = {}) {
  return {
    async: true,
    defaultResponseFormat: RESPONSE_FORMAT,
    responseFormats: [RESPONSE_FORMAT],
    generate: ({ model, body, credentials, signal, log }) => runFireflyWebUiGeneration({
      kind: "image", model, body, credentials, signal, log, deps: { dataDir: defaultDataDir, ...deps },
    }),
  };
}

export default createAdobeFireflyWebImageAdapter();
