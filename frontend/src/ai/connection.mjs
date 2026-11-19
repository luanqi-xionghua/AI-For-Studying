import { harnessRequest } from './providers.mjs';
import { runHarness } from './harness.mjs';
const nonChat = /embed|whisper|transcri|tts|speech|dall-e|gpt-image|moderation|rerank|davinci|babbage|realtime|sora/i;
export async function listModels(options) {
  const result=await runHarness(harnessRequest({...options,model:'model-discovery'},'models'),{signal:AbortSignal.any([options.signal,AbortSignal.timeout(25000)].filter(Boolean))});
  const models=result.models.filter(m=>!nonChat.test(m.id)); return {models,hidden:result.hidden+result.models.length-models.length};
}
export async function testConnection(preset,apiKey='',signal) {
  const start=Date.now(); await runHarness(harnessRequest({...preset,apiKey,messages:[{role:'user',content:'Reply OK.'}]},'ping'),{signal:AbortSignal.any([signal,AbortSignal.timeout(45000)].filter(Boolean))});
  return {ms:Date.now()-start,note:'DeepSeek Harness'};
}
