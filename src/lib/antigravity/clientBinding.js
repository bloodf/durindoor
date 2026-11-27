// The helper lives in open-sse so the gateway refresh path can use it without
// an upward import; src keeps this path for existing callers.
export {
  CLIENT_BINDING_KEY,
  clientBindingFor,
  withClientBinding,
  clientBindingStatus,
  antigravityClientBindingBlocks,
  antigravityClientBindingError
} from "../../../open-sse/services/antigravityClientBinding.js";
