import { DEFAULTS } from '../../../extension/src/common/settings.js';
import { normalizeDocumentLimits } from '../../../extension/src/common/document-limits.mjs';
import { normalizeRequestLimits } from '../../../extension/src/common/request-queue.mjs';
const keys = new Map();
const storageKey = 'paperdesk.ai.settings.v1';

/**
 * 模型预设：一个预设 = 服务商 + 接口地址 + 协议 + 模型 + 思考强度 + Fast（加一个可选的名字）。
 * 阅读助手、翻译、快速解释各从预设里选一个：assistantPreset / translationPreset / explainPreset。
 * API Key 不放在预设里：同一服务商的预设共用一把，按服务商加密保存（loadApiKey / saveAiSettings）。
 *
 * 顶层的 provider / baseUrl / protocol / model / effort / fast 始终等于阅读助手正在用的那个预设，
 * 对话、问题预判、/btw、/compress 照旧读顶层即可。顶层被外部直接改过（旧版本、测试脚本）时，以顶层为准写回该预设。
 *
 * 预设只来自用户自己「新建预设」，不自带、也不从旧设置自动生成，所以列表可以是空的。
 * 没有预设时三处用途都是空的（''），阅读助手、翻译、快速解释都会提示先新建预设（NO_PRESET_MESSAGE）。
 */
export const PRESET_FIELDS = Object.freeze(['provider', 'baseUrl', 'protocol', 'model', 'effort', 'fast']);
export const MAX_PRESETS = 12;
export const PRESET_NAME_LIMIT = 24;
/** 各用途对应的设置字段。 */
export const PRESET_TASKS = Object.freeze({ assistant: 'assistantPreset', translate: 'translationPreset', explain: 'explainPreset' });
export const NO_PRESET_MESSAGE = '还没有模型预设：请先在 设置 → AI 里点「新建预设」添加一个。';
/**
 * 预设数据的版本。第 1 版（0.10.54 的首个预设版本）会把旧设置自动换成 id 为 assistant / translation / explain 的预设；
 * 第 2 版起不再自动生成，读到还没升级的设置时把这几个自动生成的预设清掉一次（用户自己新建的 id 都是 p-xxxx）。
 */
export const PRESETS_VERSION = 2;
const AUTO_PRESET_IDS = Object.freeze(['assistant', 'translation', 'explain']);

/** 支持 Fast（优先通道）的服务商：Codex 本机登录与 OpenAI API。 */
export const supportsFast = provider => provider === 'codex' || provider === 'openai';

const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(id);
export function newPresetId() { return 'p-' + crypto.randomUUID().replaceAll('-', '').slice(0, 10); }

export function normalizePreset(raw, fallbackId = 'preset') {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: validId(raw.id) ? raw.id : fallbackId,
    name: String(raw.name ?? '').trim().slice(0, PRESET_NAME_LIMIT),
    provider: String(raw.provider || DEFAULTS.provider),
    baseUrl: String(raw.baseUrl ?? ''),
    protocol: String(raw.protocol || 'chat'),
    model: String(raw.model ?? ''),
    effort: String(raw.effort ?? ''),
    fast: Boolean(raw.fast),
  };
}
/** 预设里决定「怎么连、用哪个模型」的那几项（不含 id 与名字）。 */
export function presetConnection(preset) { return Object.fromEntries(PRESET_FIELDS.map(field => [field, preset[field]])); }

/**
 * 读到的原始设置 → 带预设的完整设置。只保留用户自己建的预设；没有就是空列表。
 * 还没升级到第 2 版的设置里，第 1 版自动生成的预设（assistant / translation / explain）清掉一次。
 */
export function normalizeAiSettings(stored = {}) {
  const source = stored && typeof stored === 'object' ? stored : {};
  const base = { ...DEFAULTS, ...source };
  delete base.apiKey;
  // 预设出现之前翻译与快速解释各有一份配置，已经不再使用。
  delete base.translation; delete base.explain;
  const cleanup = source.presetsVersion !== PRESETS_VERSION;
  const presets = [], seen = new Set();
  for (const [index, raw] of (Array.isArray(source.presets) ? source.presets : []).entries()) {
    if (cleanup && AUTO_PRESET_IDS.includes(raw?.id)) continue;
    const preset = normalizePreset(raw, `preset-${index + 1}`);
    if (!preset) continue;
    if (seen.has(preset.id)) preset.id = `${preset.id.slice(0, 30)}-${index + 1}`;
    if (seen.has(preset.id)) continue;
    seen.add(preset.id); presets.push(preset);
    if (presets.length >= MAX_PRESETS) break;
  }
  const has = id => presets.some(item => item.id === id);
  const assistantPreset = has(source.assistantPreset) ? source.assistantPreset : presets[0]?.id || '';
  const translationPreset = has(source.translationPreset) ? source.translationPreset : assistantPreset;
  const explainPreset = has(source.explainPreset) ? source.explainPreset : translationPreset;
  const index = presets.findIndex(item => item.id === assistantPreset);
  // 顶层被外部直接改过：以顶层为准写回阅读助手的预设。阅读助手原来选的预设已经不在时不写，免得把别的预设改掉。
  const top = PRESET_FIELDS.filter(field => field in source);
  if (index >= 0 && has(source.assistantPreset) && top.length) presets[index] = normalizePreset({ ...presets[index], ...Object.fromEntries(top.map(field => [field, source[field]])) }, assistantPreset);
  return {
    ...base, documentLimits: normalizeDocumentLimits(source.documentLimits), requestLimits: normalizeRequestLimits(source.requestLimits),
    presetsVersion: PRESETS_VERSION, presets, assistantPreset, translationPreset, explainPreset, ...(index >= 0 ? presetConnection(presets[index]) : {}),
  };
}
/** 至少有一个预设（没有时 AI 功能都要先去新建）。 */
export const hasPresets = settings => Boolean(settings?.presets?.length);

function readStored() {
  try { const value = JSON.parse(localStorage.getItem(storageKey) || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; }
}
function writeStored(settings) {
  const clean = { ...settings };
  delete clean.apiKey;
  localStorage.setItem(storageKey, JSON.stringify(clean));
}
export function loadAiSettings() { return normalizeAiSettings(readStored()); }

export async function loadApiKey(provider) {
  if (keys.has(provider)) return keys.get(provider);
  if (globalThis.__TAURI_INTERNALS__) {
    const { invoke } = await import('@tauri-apps/api/core');
    const key = await invoke('get_credential', { provider });
    if (key) keys.set(provider, key);
    return key || '';
  }
  return '';
}
/**
 * 保存 AI 设置。apiKey 可以是：
 * - 字符串：阅读助手所用服务商的密钥（旧的调用方式，每次都按「记住密钥」写入或清除）；
 * - { 服务商: 密钥 }：只写这些服务商（设置页只传改动过的），同样按「记住密钥」写入或清除。
 */
export async function saveAiSettings(settings, apiKey) {
  const clean = normalizeAiSettings(settings);
  const entries = apiKey && typeof apiKey === 'object' ? Object.entries(apiKey) : [[clean.provider, apiKey || '']];
  for (const [provider, key] of entries) {
    if (!provider) continue;
    keys.set(provider, key || '');
    if (globalThis.__TAURI_INTERNALS__ && provider !== 'codex') {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_credential', { provider, key: clean.rememberKey ? key || '' : '' });
    }
  }
  writeStored(clean);
  return clean;
}
// 输入栏的快捷选择只改阅读助手的模型、思考强度与 Fast，存储里也只动这几项顶层字段：
// 读取时顶层字段会同步回阅读助手所用的预设（见 normalizeAiSettings），换预设时再整体写入。
export function saveModelChoice(model, effort, fast) {
  const stored = readStored();
  delete stored.apiKey;
  localStorage.setItem(storageKey, JSON.stringify({ ...stored, model: String(model ?? ''), effort: String(effort ?? ''), ...(fast === undefined ? {} : { fast: Boolean(fast) }) }));
}
/** 给某个用途（assistant / translate / explain）换一个预设；换阅读助手的预设时顶层字段跟着换。 */
export function saveTaskPreset(task, id) {
  const field = PRESET_TASKS[task];
  if (!field) throw new Error('未知的预设用途。');
  const settings = loadAiSettings();
  const preset = settings.presets.find(item => item.id === id);
  if (!preset) throw new Error('找不到这个模型预设。');
  const next = { ...settings, [field]: id, ...(task === 'assistant' ? presetConnection(preset) : {}) };
  writeStored(next);
  return normalizeAiSettings(next);
}
/** 某个用途选中的预设；选的预设不在了就退回第一个；一个预设都没有时是 undefined。 */
export function presetFor(main, task) {
  const settings = main?.presets ? main : normalizeAiSettings(main);
  return settings.presets.find(item => item.id === settings[PRESET_TASKS[task]]) || settings.presets[0];
}
function taskSettings(main, task) {
  const settings = main?.presets ? main : normalizeAiSettings(main);
  const preset = presetFor(settings, task);
  // 没有预设：连接信息全部留空，调用方据 preset 为 null 提示先新建预设，不会悄悄用上别的配置。
  if (!preset) return { ...settings, provider: '', baseUrl: '', protocol: 'chat', model: '', effort: '', fast: false, preset: null };
  return { ...settings, ...presetConnection(preset), fast: Boolean(preset.fast) && supportsFast(preset.provider), preset };
}
/** 翻译用的 AI：取翻译所选的预设。模型留空时由调用方换成该服务商的默认模型与最低思考强度。 */
export function translationSettings(main = loadAiSettings()) { return taskSettings(main, 'translate'); }
/** 快速解释用的 AI：取快速解释所选的预设。 */
export function explainSettings(main = loadAiSettings()) { return taskSettings(main, 'explain'); }
