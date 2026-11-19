import { createNativeHttpFetch } from './native-http.mjs';
let nativeFetch;
// Tests replace this adapter with a deterministic response; the app always uses Python.
export const aiTransport = {
  async fetch(url, options) {
    if (!nativeFetch) {
      const { invoke, Channel } = await import('../sdk/python');
      nativeFetch = createNativeHttpFetch(invoke, Channel);
    }
    return nativeFetch(url, options);
  },
};
export const transportFetch = (url, options) => aiTransport.fetch(url, options);
