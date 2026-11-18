// 设置页用到的两件事：向服务商读取模型列表（「获取模型列表」），以及测试一个预设能不能用（「测试连接」）。
// 两者都走和正式对话相同的传输：桌面版经 Rust 的 HTTP（不受跨域限制），浏览器预览用 fetch。
import { getProvider, protocolOf, buildPayload, getNativeModels, getNativeStatus } from './providers.mjs';
import { readSSE } from './sse.mjs';
import { transportFetch } from './transport.mjs';
import { apiOrigin } from '../../../extension/src/common/settings.js';

const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i;
const ANTHROPIC_VERSION = '2023-06-01';
const LIST_TIMEOUT = 20_000;
const TEST_TIMEOUT = 30_000;
/** 已经回了 200、但迟迟没有第一个事件（模型在长考）：等这么久就算连上了。 */
const FIRST_EVENT_GRACE = 10_000;
const PING = 'ping';
/** 列表里明显不是对话模型的（向量、语音、画图、审核、重排……），读到了也不列出来。 */
export const NOT_CHAT_MODEL = /embed|whisper|transcri|tts|speech|dall-e|gpt-image|moderation|rerank|davinci|babbage|realtime|sora/i;

/** 预设的 API 地址 → 去掉末尾斜杠的根地址；顺便检查地址本身（HTTPS、不带查询参数等）。 */
function rootOf(baseUrl) {
  const root = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!root) throw new Error('请先填写 API 地址。');
  apiOrigin(root);
  return root;
}
function needKey(root, apiKey) {
  if (!apiKey && !LOCAL.test(root)) throw new Error('请先填写 API Key。');
}
const anthropicRoot = root => root.replace(/\/v1$/, '');
function anthropicHeaders(apiKey, json = false) {
  // 浏览器预览直连 Claude 时需要最后这一项（官方 SDK 在 dangerouslyAllowBrowser 下也会带上）。
  return { ...(json ? { 'content-type': 'application/json' } : {}), 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-dangerous-direct-browser-access': 'true' };
}
const bearer = apiKey => apiKey ? { Authorization: 'Bearer ' + apiKey } : {};
const hide = (text, apiKey) => (apiKey ? String(text).split(apiKey).join('[已隐藏]') : String(text));

/** 各家报错的正文：OpenAI 兼容 {error:{message}}、Claude {error:{type,message}}、也有直接 {message} 或纯文本。 */
function errorDetail(text, apiKey) {
  let detail = '';
  try {
    const body = JSON.parse(text);
    detail = body?.error?.message || (typeof body?.error === 'string' ? body.error : '') || body?.message || body?.msg || body?.detail || '';
    if (typeof detail !== 'string') detail = JSON.stringify(detail);
  } catch { detail = /^\s*</.test(text) ? '' : String(text || '').trim(); }
  return hide(detail, apiKey).replace(/\s+/g, ' ').slice(0, 300);
}
function httpError(status, text, apiKey, what = '') {
  const detail = errorDetail(text, apiKey);
  const hint = status === 401 || status === 403 ? 'API Key 无效或没有权限'
    : status === 404 ? `找不到${what || '这个接口'}，请检查 API 地址`
    : status === 402 || status === 429 ? '额度不足或请求太频繁' : '';
  return new Error(`服务返回 HTTP ${status}` + (detail ? `：${detail}` : hint ? `：${hint}` : '。'));
}
/** 请求没发出去或没有回应：超时说超时，连不上就写明是哪台服务器（原始报错放在后面）。 */
function networkError(error, signal, seconds, url) {
  if (signal?.aborted && signal.reason?.name === 'TimeoutError') return new Error(`等了 ${seconds} 秒还没有回应，请检查网络或 API 地址。`);
  if (signal?.aborted || error?.name === 'AbortError') return error;
  let host = '';
  try { host = new URL(url).host; } catch { /* 地址前面已经检查过 */ }
  return new Error(`连不上 ${host || '服务'}，请检查网络、代理或 API 地址（${String(error?.message || error).slice(0, 200)}）。`);
}

/**
 * 读取服务商的模型列表。OpenAI 兼容与 Responses：GET {地址}/models；Claude：GET /v1/models。
 * 返回 { models: [{ id, name? }], hidden }：hidden 是略去的非对话模型个数。内置列表认识的模型排在前面、用内置的名字。
 * Codex 不走这里（设置页直接读本机 Codex 的模型）。
 * @param {{ provider: string, protocol?: string, baseUrl: string, apiKey?: string, signal?: AbortSignal }} options
 */
export async function listModels({ provider, protocol, baseUrl, apiKey = '', signal }) {
  if (provider === 'codex') throw new Error('Codex 的模型从本机读取。');
  const root = rootOf(baseUrl);
  needKey(root, apiKey);
  const wire = protocolOf(provider, protocol);
  const url = wire === 'anthropic' ? anthropicRoot(root) + '/v1/models?limit=1000' : root + '/models';
  const headers = wire === 'anthropic' ? anthropicHeaders(apiKey) : bearer(apiKey);
  const timed = AbortSignal.any([signal, AbortSignal.timeout(LIST_TIMEOUT)].filter(Boolean));
  let response, text;
  try {
    response = await transportFetch(url, { method: 'GET', signal: timed, redirect: 'error', cache: 'no-store', credentials: 'omit', headers });
    text = await response.text();
  } catch (error) { throw networkError(error, timed, LIST_TIMEOUT / 1000, url); }
  if (!response.ok) {
    if (response.status === 404 || response.status === 405) throw new Error(`没读到模型列表（HTTP ${response.status}）：API 地址可能不对，或这家服务不提供模型列表。也可以直接在左边填写模型名称。`);
    throw httpError(response.status, text, apiKey);
  }
  let body;
  try { body = JSON.parse(text); } catch { throw new Error('服务返回的不是模型列表，请检查 API 地址。'); }
  const raw = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : Array.isArray(body) ? body : null;
  if (!raw) throw new Error('服务返回的不是模型列表，请检查 API 地址。');
  const known = getProvider(provider)?.models || [];
  const seen = new Set(), models = [];
  let hidden = 0;
  for (const item of raw) {
    const id = String(typeof item === 'string' ? item : item?.id ?? item?.name ?? item?.model ?? '').trim();
    if (!id || id.length > 200 || seen.has(id)) continue;
    seen.add(id);
    if (NOT_CHAT_MODEL.test(id)) { hidden++; continue; }
    const builtIn = known.find(model => model.id === id);
    const label = builtIn?.name || (item && typeof item === 'object' ? String(item.display_name || item.name || '').trim() : '');
    models.push({ id, ...(label && label !== id ? { name: label } : {}) });
  }
  const rank = id => { const index = known.findIndex(model => model.id === id); return index < 0 ? known.length : index; };
  models.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
  return { models, hidden };
}

/**
 * 测试一个预设：用它的地址、密钥、模型和思考强度发一句极短的「ping」（与正式对话的请求格式相同），
 * 服务一开始回应（第一个流式事件）就中断，几乎不耗额度。能同时验证地址、密钥、模型名与思考参数。
 * 成功返回 { ms, note }；失败抛出带原因的错误。Codex：检查本机登录，并确认所选模型在本机列表里。
 */
export async function testConnection(preset, apiKey = '', signal) {
  const started = Date.now();
  if (preset.provider === 'codex') {
    const info = await getNativeStatus(signal);
    if (!info?.compatible || !info?.loggedIn) throw new Error(info?.diagnostic || (info?.loggedIn === false ? 'Codex 尚未登录。请先在 Codex 中登录。' : '未找到可用 Codex。'));
    if (preset.model) {
      const list = await getNativeModels(signal);
      if (list.length && !list.some(item => item.id === preset.model)) throw new Error(`已登录，但本机 Codex 没有模型「${preset.model}」。`);
    }
    return { ms: Date.now() - started, note: info.version ? `Codex ${info.version} · 已登录` : 'Codex 已登录' };
  }
  if (!getProvider(preset.provider)) throw new Error('未知服务商。');
  const root = rootOf(preset.baseUrl);
  needKey(root, apiKey);
  const model = String(preset.model || '').trim();
  if (!model) throw new Error('请先填写模型名称。');
  const wire = protocolOf(preset.provider, preset.protocol);
  let url, headers, body;
  if (wire === 'anthropic') {
    const { claudeThinking } = await import('./anthropic.mjs');
    url = anthropicRoot(root) + '/v1/messages';
    headers = anthropicHeaders(apiKey, true);
    body = { model, max_tokens: 1024, stream: true, messages: [{ role: 'user', content: PING }], ...claudeThinking(model, preset.effort) };
  } else {
    url = root + (wire === 'responses' ? '/responses' : '/chat/completions');
    headers = { 'Content-Type': 'application/json', ...bearer(apiKey) };
    // 与正式对话同一个构造函数：思考参数、Fast 都一样（不支持的强度在这里就会报出来）。
    body = buildPayload({ provider: preset.provider, protocol: preset.protocol, model, effort: preset.effort || '', fast: Boolean(preset.fast), messages: [{ role: 'user', content: PING }] });
  }
  const stop = new AbortController();
  const timed = AbortSignal.any([signal, stop.signal, AbortSignal.timeout(TEST_TIMEOUT)].filter(Boolean));
  try {
    let response;
    try { response = await transportFetch(url, { method: 'POST', signal: timed, redirect: 'error', cache: 'no-store', credentials: 'omit', headers, body: JSON.stringify(body) }); }
    catch (error) { throw networkError(error, timed, TEST_TIMEOUT / 1000, url); }
    if (!response.ok) throw httpError(response.status, await response.text().catch(() => ''), apiKey, '这个接口或模型');
    // 有的网关先回 200，再在流里报错：看第一个事件。模型在长考、一直没有事件时，等一会儿也算连上了。
    const first = (async () => {
      for await (const data of readSSE(response, timed)) {
        if (data === '[DONE]') return;
        let event;
        try { event = JSON.parse(data); } catch { throw new Error('服务返回了无法解析的流式数据，可能不是所选的接口协议。'); }
        const failure = event?.error || (event?.type === 'error' || event?.type === 'response.failed' ? event?.response?.error || event : null);
        if (failure) throw new Error('模型返回错误：' + hide(failure.message || failure.error?.message || JSON.stringify(failure), apiKey).slice(0, 300));
        return;
      }
    })();
    let timer;
    const grace = new Promise(resolve => { timer = setTimeout(resolve, FIRST_EVENT_GRACE); });
    try { await Promise.race([first, grace]); } finally { clearTimeout(timer); }
    first.catch(() => {});
    return { ms: Date.now() - started, note: '' };
  } finally {
    // 不等回答写完：连接到此为止。
    stop.abort();
  }
}
