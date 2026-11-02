// Match Next/Vitest interop for the explicitly CommonJS shared runtime limits.
export { resolve } from '../../scripts/alias-loader.mjs';
export async function load(url, context, nextLoad) {
  if (url.endsWith('/src/shared/utils/realtimeConfig.js')) {
    return nextLoad(url, {
      ...context,
      format: 'commonjs'
    });
  }
  return nextLoad(url, context);
}
