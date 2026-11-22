// Internal request identity; callers cannot set this through HTTP headers.
const admittedRequestKeys = new WeakMap();
const batchRequestKeys = new WeakMap();

export function rememberAdmittedRequestKey(request, keyId) {
  admittedRequestKeys.set(request, keyId);
}

export function getAdmittedRequestKeyId(request) {
  return admittedRequestKeys.get(request) || null;
}

export function bindBatchRequestKey(request, keyId) {
  batchRequestKeys.set(request, keyId);
}

export function getBatchRequestKeyId(request) {
  return batchRequestKeys.get(request) || null;
}
