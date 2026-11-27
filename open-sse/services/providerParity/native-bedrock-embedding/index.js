// Private staging entry; production must not import until serial registration.
import { createBedrockEmbeddingAdapter } from "./adapter.js";
export * from "./config.js";
export * from "./request.js";
export * from "./adapter.js";
export const bedrockEmbeddingAdapter = createBedrockEmbeddingAdapter();
export { discoverBedrockEmbeddingModels } from "./discovery.js";
