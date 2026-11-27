// Adobe Firefly Services API (developer.adobe.com/firefly-services): image
// generation and Adobe's native text-to-video. Registered for #2034 (1127):
// images run through the shared image core and video through
// /v1/video/generations. See docs/providers/adobe-firefly-api.md.
//
// Image and video models are separate lists with their own kind, and each
// adapter refuses the other kind's models.
//
// This is the operator-entitled Services API, authenticated with an Adobe
// Developer Console OAuth Server-to-Server credential. It is not the consumer
// firefly.adobe.com web app: the IDs `adobe-firefly` and `firefly` stay
// unregistered (docs/providers/adobe-firefly.md), and no web-app client ID,
// cookie or browser header is accepted or sent.
//
// Contract sources, AdobeDocs/ffs-firefly-api at
// 1027f559cdb1509a61b34e2f2da9618ec431f2cb (static/firefly-api.json blob
// 9004da2c5d57850bb72068e6e06b93e04b1bad9e, OpenAPI 3.1.0, info.version 3.0.0,
// last changed in 0fed5f9c3437ce1072bc7a01616b5d15c5eb1030):
// - server https://firefly-api.adobe.io; POST /v3/images/generate-async,
//   GET /v3/status/{jobId}, PUT /v3/cancel/{jobId}; `x-model-version` header
// - POST /v3/videos/generate (operationId generateVideoV3): `x-model-version`
//   enum ["video1_standard"], GenerateVideoRequestV3 body, 202
//   AsyncAcceptResponseV3; video results per AsyncResult / VideoOutput
// - src/pages/getting-started/usage-notes/index.md (blob
//   975ebb6e3e875cb66c0d600abde6d7518682f8b4): "Generate Video API usage",
//   supported aspect ratios and dimensions; per-organization rate limits
// - src/pages/getting-started/changelog/index.md (blob
//   6c92714c45bbe0a80aa15baf3c4bb3a79190005b): June 19, 2025 Generate Video launch
// - src/pages/getting-started/index.md: IMS token request and scope list
// - src/pages/guides/how-tos/using-async-apis.md: submit/poll sequence

export const ADOBE_FIREFLY_API_ID = "adobe-firefly-api";

// The only destinations credentials are ever sent to. Connection settings and
// upstream responses cannot change them.
export const ADOBE_IMS_TOKEN_URL = "https://ims-na1.adobelogin.com/ims/token/v3";
export const ADOBE_FIREFLY_API_ORIGIN = "https://firefly-api.adobe.io";
export const ADOBE_FIREFLY_GENERATE_URL = `${ADOBE_FIREFLY_API_ORIGIN}/v3/images/generate-async`;
export const ADOBE_FIREFLY_VIDEO_GENERATE_URL = `${ADOBE_FIREFLY_API_ORIGIN}/v3/videos/generate`;
export const adobeFireflyStatusUrl = (jobId) => `${ADOBE_FIREFLY_API_ORIGIN}/v3/status/${jobId}`;
export const adobeFireflyCancelUrl = (jobId) => `${ADOBE_FIREFLY_API_ORIGIN}/v3/cancel/${jobId}`;

// Scope list exactly as the getting-started page requests it.
export const ADOBE_FIREFLY_SCOPE = "openid,AdobeID,session,additional_info,read_organizations,firefly_api,ff_apis";

// Client IDs of Adobe's own consumer web apps. These are never accepted: this
// provider only uses the operator's own Developer Console credential.
export const ADOBE_WEB_APP_CLIENT_IDS = Object.freeze(["clio-playground-web", "projectx_webapp"]);

// `x-model-version` values that need no custom model id.
const MODELS = [
  ["image3", "Firefly Image 3"],
  ["image4_standard", "Firefly Image 4"],
  ["image4_ultra", "Firefly Image 4 Ultra"],
];

export const ADOBE_FIREFLY_API_MODEL_IDS = Object.freeze(MODELS.map(([id]) => id));

// Video: the only documented `x-model-version` for POST /v3/videos/generate.
const VIDEO_MODELS = [["video1_standard", "Firefly Video 1"]];

export const ADOBE_FIREFLY_VIDEO_MODEL_IDS = Object.freeze(VIDEO_MODELS.map(([id]) => id));

// The operation description: "Generate a five second video using a text prompt."
export const ADOBE_FIREFLY_VIDEO_SECONDS = 5;

// The usage notes' supported dimensions, as [width, height].
export const ADOBE_FIREFLY_VIDEO_SIZES = Object.freeze([
  [1920, 1080], [1280, 720], [960, 540],
  [1080, 1920], [720, 1280], [540, 960],
  [1080, 1080], [720, 720], [540, 540],
].map((size) => Object.freeze(size)));

// Video description. There is deliberately no videoConfig on the default
// export: the shared /v1/videos proxy forwards the client body to a base URL
// and cannot mint IMS tokens, so video runs only through the synchronous
// /v1/video/generations adapter (handlers/videoProviders/adobe-firefly-api.js).
export const ADOBE_FIREFLY_VIDEO = Object.freeze({
  serviceKinds: Object.freeze(["video"]),
  models: Object.freeze(VIDEO_MODELS.map(([id, name]) => Object.freeze({
    id, name, kind: "video", params: Object.freeze(["size", "seconds", "seed"]),
  }))),
  generateUrl: ADOBE_FIREFLY_VIDEO_GENERATE_URL,
});

export default {
  id: ADOBE_FIREFLY_API_ID,
  alias: ADOBE_FIREFLY_API_ID,
  uiAlias: ADOBE_FIREFLY_API_ID,
  display: {
    name: "Adobe Firefly Services API",
    icon: "image",
    color: "#475569",
    textIcon: "FS",
    website: "https://developer.adobe.com/firefly-services/docs/firefly-api/",
    notice: {
      text: "Text-to-image and Adobe's native five-second text-to-video. Needs a Firefly Services API entitlement and an OAuth Server-to-Server credential (client ID and client secret) from Adobe Developer Console. A Firefly or Creative Cloud subscription alone does not grant API access. Results are pre-signed URLs (response_format url).",
      apiKeyUrl: "https://developer.adobe.com/console",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: null,
  authHint: "Client secret of an Adobe Developer Console OAuth Server-to-Server credential; its client ID goes in the Client ID field.",
  models: [
    ...MODELS.map(([id, name]) => ({ id, name, params: ["size", "n"], kind: "image" })),
    ...ADOBE_FIREFLY_VIDEO.models.map((model) => ({ ...model, params: [...model.params] })),
  ],
  serviceKinds: ["image", "video"],
  imageConfig: { baseUrl: ADOBE_FIREFLY_GENERATE_URL },
};
