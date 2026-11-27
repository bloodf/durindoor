// Adobe Firefly consumer web UI, video (#2034). STAGED: not in VIDEO_GENERATION_ADAPTERS,
// so unavailable to users. See docs/providers/adobe-firefly-web.md.
//
// The adapter runs the guarded browser flow in services/fireflyWebUi through
// the `.generate({ model, body, credentials, signal, log })` contract and
// returns `{ success, response, accounting }` or an error result that keeps
// `acceptedJob` when the submit may have been taken. It has no useExecutor
// path, which would drop that accepted job.
//
// Output is this gateway's own local synchronous b64_json body,
// `{ created, data: [{ b64_json, mime_type, output_format }] }`, built from
// the verified downloaded MP4 or WebM file (mime_type and output_format name
// the verified container). It is not an Adobe API response. An omitted
// response_format means b64_json; any other format is refused before launch.
import { runFireflyWebUiGeneration } from "../../services/fireflyWebUi/flow.js";
import { RESPONSE_FORMAT } from "../../services/fireflyWebUi/config.js";

const defaultDataDir = async () => (await import("../../../src/lib/dataDir.js")).DATA_DIR;

/** @param {object} [deps] - launcher, dataDir, journal, tmpRoot; see runFireflyWebUiGeneration */
export function createAdobeFireflyWebVideoAdapter(deps = {}) {
  return {
    async: true,
    responseFormats: [RESPONSE_FORMAT],
    generate: ({ model, body, credentials, signal, log }) => runFireflyWebUiGeneration({
      kind: "video", model, body, credentials, signal, log, deps: { dataDir: defaultDataDir, ...deps },
    }),
  };
}

export default createAdobeFireflyWebVideoAdapter();
// There is no /v1/videos job or cancel route for this provider: the flow is
// synchronous, Adobe's UI documents no job id or cancellation, and none is
// invented here.
