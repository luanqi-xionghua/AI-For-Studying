import { DEFAULTS } from '../shared/provider-config.mjs';
import { normalizeDocumentLimits } from '../shared/document-limits.mjs';
import { normalizeRequestLimits } from '../shared/request-queue.mjs';
import { getModel } from './providers.mjs';

const storageKey = 'paperdesk.ai.settings.v1';

/**
 * 模型预设：一个预设 = 服务商 + 接口地址 + 协议 + 模型 + 思考强度 + Fast（加一个可选的名字）。
 * 阅读助手、翻译、快速解释各从预设里选一个：assistantPreset / translationPreset / explainPreset。
 * 记忆管理也从预设里选一个（memoryPreset），并且单独记一个思考强度（memoryEffort）。
 * API Key 不放在预设里：相同服务商与地址共用；由 Python 管理，不向界面读回明文。
 *
 * 顶层的 provider / baseUrl / protocol / model / effort / fast 始终等于阅读助手正在用的那个预设，
 * 对话、问题预判、/btw、/compress 照旧读顶层即可。顶层被外部直接改过（旧版本、测试脚本）时，以顶层为准写回该预设。
 *
 * 预设只来自用户自己「新建预设」，不自带、也不从旧设置自动生成，所以列表可以是空的。
 * 没有预设时各处用途都是空的（''），阅读助手、翻译、快速解释、记忆管理都会提示先新建预设（NO_PRESET_MESSAGE）。
 */
export const PRESET_FIELDS = Object.freeze(['provider', 'baseUrl', 'protocol', 'model', 'effort', 'fast']);
export const MAX_PRESETS = 12;
export const PRESET_NAME_LIMIT = 24;
/** 各用途对应的设置字段。 */
export const PRESET_TASKS = Object.freeze({ assistant: 'assistantPreset', translate: 'translationPreset', explain: 'explainPreset', memory: 'memoryPreset' });
export const NO_PRESET_MESSAGE = '还没有模型预设：请先在 设置 → AI 里点「新建预设」添加一个。';
/** 算作「高强度」的档位：选中时要二次确认并显示常驻提示。 */
export const HIGH_MEMORY_EFFORTS = Object.freeze(['high', 'xhigh', 'max', 'ultra']);
/** 模型不在内置列表里（自定义模型）时可选的档位，与输入栏对自定义模型的后备档位一致。 */
export const MEMORY_FALLBACK_EFFORTS = Object.freeze(['none', 'low', 'medium', 'high', 'xhigh']);
/** 推荐强度：模型的 efforts 含 'low' → 'low'；否则 ''（模型默认）。model 可以是 undefined。 */
export function recommendedMemoryEffort(model) {
  return Array.isArray(model?.efforts) && model.efforts.includes('low') ? 'low' : '';
}
export function isHighMemoryEffort(effort) { return HIGH_MEMORY_EFFORTS.includes(effort); }
/** 这个预设的模型可选的强度（不含 ''）。没有预设 → []；已知模型 → 它的 efforts；未知模型 → 后备档位。 */
export function memoryEffortOptions(preset) {
  if (!preset) return [];
  const known = getModel(preset.provider, preset.model);
  return known ? [...(known.efforts || [])] : [...MEMORY_FALLBACK_EFFORTS];
}
/** 这个预设的模型对象（未知模型是 undefined），供 recommendedMemoryEffort 使用。 */
export function memoryModelOf(preset) { return preset ? getModel(preset.provider, preset.model) : undefined; }
/**
 * 预设数据的版本。第 1 版（0.10.54 的首个预设版本）会把旧设置自动换成 id 为 assistant / translation / explain 的预设；
 * 第 2 版起不再自动生成，读到还没升级的设置时把这几个自动生成的预设清掉一次（用户自己新建的 id 都是 p-xxxx）。
 */
export const PRESETS_VERSION = 2;
const AUTO_PRESET_IDS = Object.freeze(['assistant', 'translation', 'explain']);

/** 当前 Harness 适配器不提供优先计费通道。 */
export const supportsFast = _provider => false;

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
    if (!preset || preset.provider === 'codex') continue;
    if (seen.has(preset.id)) preset.id = `${preset.id.slice(0, 30)}-${index + 1}`;
    if (seen.has(preset.id)) continue;
    seen.add(preset.id); presets.push(preset);
    if (presets.length >= MAX_PRESETS) break;
  }
  const has = id => presets.some(item => item.id === id);
  const assistantPreset = has(source.assistantPreset) ? source.assistantPreset : presets[0]?.id || '';
  const translationPreset = has(source.translationPreset) ? source.translationPreset : assistantPreset;
  const explainPreset = has(source.explainPreset) ? source.explainPreset : translationPreset;
  // 记忆管理：旧设置没有这两个字段时沿用阅读助手的预设、强度取该模型的推荐值。
  const chosenMemory = has(source.memoryPreset);
  const memoryPreset = chosenMemory ? source.memoryPreset : assistantPreset;
  const memoryItem = presets.find(item => item.id === memoryPreset);
  const memoryOptions = memoryEffortOptions(memoryItem);
  const keepEffort = chosenMemory && typeof source.memoryEffort === 'string'
    && (source.memoryEffort === '' || memoryOptions.includes(source.memoryEffort));
  const memoryEffort = keepEffort ? source.memoryEffort : recommendedMemoryEffort(memoryModelOf(memoryItem));
  const index = presets.findIndex(item => item.id === assistantPreset);
  // 顶层被外部直接改过：以顶层为准写回阅读助手的预设。阅读助手原来选的预设已经不在时不写，免得把别的预设改掉。
  const top = PRESET_FIELDS.filter(field => field in source);
  if (index >= 0 && has(source.assistantPreset) && source.provider !== 'codex' && top.length) presets[index] = normalizePreset({ ...presets[index], ...Object.fromEntries(top.map(field => [field, source[field]])) }, assistantPreset);
  return {
    ...base, ...(base.provider === 'codex' ? {provider:DEFAULTS.provider,baseUrl:DEFAULTS.baseUrl,model:DEFAULTS.model,effort:''} : {}), documentLimits: normalizeDocumentLimits(source.documentLimits), requestLimits: normalizeRequestLimits(source.requestLimits),
    translationChoices: cleanTranslationChoices(presets, source.translationChoices),
    presetsVersion: PRESETS_VERSION, presets, assistantPreset, translationPreset, explainPreset, memoryPreset, memoryEffort, ...(index >= 0 ? presetConnection(presets[index]) : {}),
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

export const credentialSlot = p => JSON.stringify([p.provider, p.baseUrl.trim().replace(/\/+$/, '')]);
export async function saveAiSettings(settings, changes = []) {
  const clean=normalizeAiSettings(settings);
  if (globalThis.__KAIZHI_PYTHON__ && changes.length) {
    const {invoke}=await import('../sdk/python');
    for(const change of changes) await invoke('ai_set_key',{...change,remember:Boolean(clean.rememberKey)});
  }
  writeStored(clean); return clean;
}
export function saveModelChoice(model, effort, fast) {
  const stored = readStored();
  delete stored.apiKey;
  localStorage.setItem(storageKey, JSON.stringify({ ...stored, model: String(model ?? ''), effort: String(effort ?? ''), ...(fast === undefined ? {} : { fast: Boolean(fast) }) }));
}
/** 给某个用途（assistant / translate / explain / memory）换一个预设；换阅读助手的预设时顶层字段跟着换。 */
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
// 翻译栏的选择只属于翻译：即使三种用途共用预设，也不能改写阅读助手或快速解释。
const translationScope = p => JSON.stringify([p.provider, p.baseUrl, p.protocol]);
function cleanTranslationChoices(presets, choices) {
  return Object.fromEntries(presets.flatMap(p => {
    const c = choices?.[p.id];
    return c?.scope === translationScope(p) && typeof c.model === 'string' && c.model && typeof c.effort === 'string'
      ? [[p.id, { scope: c.scope, model: c.model, effort: c.effort }]] : [];
  }));
}
/** 无单独选择时沿用预设；可预览尚未确认的另一个预设，不写入存储。 */
export function translationSettings(main = loadAiSettings(), id = main.translationPreset) {
  const settings = taskSettings({ ...main, translationPreset: id }, 'translate');
  const p = settings.preset, c = p && settings.translationChoices?.[p.id];
  return p && c?.scope === translationScope(p) ? { ...settings, model: c.model, effort: c.effort } : settings;
}
export function saveTranslationChoice(id, model, effort) {
  const settings = loadAiSettings();
  const p = settings.presets.find(item => item.id === id);
  if (!p) throw new Error('找不到这个模型预设。');
  model = model.trim();
  if (!model) throw new Error('请输入模型 ID。');
  const choices = { ...settings.translationChoices, [id]: { scope: translationScope(p), model, effort } };
  if (model === p.model && effort === p.effort) delete choices[id];
  writeStored({ ...settings, translationPreset: id, translationChoices: choices });
}
/** 快速解释用的 AI：取快速解释所选的预设。 */
export function explainSettings(main = loadAiSettings()) { return taskSettings(main, 'explain'); }

/**
 * 记忆总结用的连接参数。没有可用预设时 preset 为 null，调用方据此不发请求。
 * 不走 presetFor 的「找不到就退回第一个」：回退已经在归一化里做完，这里找不到就是真的没有预设。
 */
export function memorySettings(main = loadAiSettings()) {
  const settings = main?.presets ? main : normalizeAiSettings(main);
  const preset = settings.presets.find(item => item.id === settings.memoryPreset);
  if (!preset) return { ...settings, provider: '', baseUrl: '', protocol: 'chat', model: '', effort: '', fast: false, preset: null };
  const effort = settings.memoryEffort && memoryEffortOptions(preset).includes(settings.memoryEffort) ? settings.memoryEffort : '';
  return { ...settings, ...presetConnection(preset), effort, fast: false, preset };
}
