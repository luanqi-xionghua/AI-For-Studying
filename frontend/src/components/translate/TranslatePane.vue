<script setup lang="ts">
// 左侧的翻译栏：像阅读助手一样的一列，译文按卡片从上往下排，底下可以直接输入要翻译的文字。
// 与阅读助手共用外壳的主题样式（.ai-pane），内部元素用 tp- 前缀，互不干扰。
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from '../ui/AppIcon.vue'
import { renderMarkdown } from '../../ai/render'
import ModelPicker from '../assistant/ModelPicker.vue'
import { loadAiSettings, translationSettings, saveTranslationChoice, supportsFast } from '../../ai/settings.mjs'
import { composerModels, effortForModel, presetTitle, presetDetail, modelName, EFFORT_NAMES, type Preset } from '../../ai/presets'
import { translator, translate, stopTranslation, removeTranslation, clearTranslations, TARGETS, type Translation } from '../../ai/translate'

defineProps<{ shortcut?: string }>()
const emit = defineEmits<{ close: []; settings: []; grab: [event: PointerEvent] }>()
// 按住标题栏空白处拖动：把整个翻译栏拖到阅读区的另一侧。
function grab(event: PointerEvent) { if (event.button === 0 && !(event.target as HTMLElement).closest('button, input, textarea, select, a')) emit('grab', event) }
const draft = ref('')
const list = ref<HTMLElement>()
const field = ref<HTMLTextAreaElement>()
const copied = ref('')
const LABEL: Record<string, string> = { zh: '中文', en: 'English', ja: '日本語' }
// 翻译只用 AI；以前的记录里可能还有别的服务翻的，卡片上照旧注明。
const OLD_ENGINE: Record<string, string> = { google: '谷歌', 'google-api': '谷歌云', youdao: '有道' }
// 草稿与生效配置分开：只有「确定」才会影响下一次翻译。
const mainSettings = ref(loadAiSettings())
const aiSettings = computed(() => translationSettings(mainSettings.value))
const aiPicker = ref(false)
const drawerMounted = ref(false)
const composerField = ref<HTMLElement>()
const pickerHost = ref<HTMLElement>()
const tempPreset = ref(''), tempModel = ref(''), tempEffort = ref('')
function refreshAi() { mainSettings.value = loadAiSettings() }
const presetChips = computed(() => mainSettings.value.presets.filter((p): p is Preset => p !== null).map(p => ({ id: p.id, name: presetTitle(p), detail: presetDetail(p) })))
const preview = computed(() => translationSettings(mainSettings.value, tempPreset.value))
const pickerModels = computed(() => composerModels(preview.value.provider, preview.value.model, preview.value.preset?.model || ''))
function choosePreset(id: string) {
  tempPreset.value = id
  tempModel.value = preview.value.model
  tempEffort.value = effortForModel(pickerModels.value.find(m => m.id === tempModel.value), preview.value.effort)
}
function chooseModel(id: string) {
  tempModel.value = id
  tempEffort.value = effortForModel(pickerModels.value.find(m => m.id === id), tempEffort.value)
}
// 抽屉开着时，点输入栏以外的地方就收起（同阅读助手）。
function pickerOutside(event: PointerEvent) { if (event.target instanceof Node && !composerField.value?.contains(event.target)) aiPicker.value = false }
watch(aiPicker, open => {
  if (open) {
    refreshAi()
    choosePreset(aiSettings.value.preset?.id || '')
    drawerMounted.value = true
    document.addEventListener('pointerdown', pickerOutside, true)
  }
  else document.removeEventListener('pointerdown', pickerOutside, true)
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', pickerOutside, true))
function closePicker() { aiPicker.value = false; void nextTick(() => pickerHost.value?.querySelector<HTMLElement>('.tp-picker')?.focus()) }
function drawerEscape(event: KeyboardEvent) { if (!aiPicker.value || event.defaultPrevented) return; event.preventDefault(); event.stopPropagation(); closePicker() }
// 窄栏优先显示实际模型；完整的预设名放在提示里。
const aiLabel = computed(() => aiSettings.value.preset ? modelName(aiSettings.value) : '未设置模型预设')
const effortLabel = computed(() => aiSettings.value.preset ? EFFORT_NAMES[aiSettings.value.effort] || aiSettings.value.effort : '')
// 还没有模型预设：预设按钮点了直接去 设置 → AI 新建，不拉开抽屉。
function toggleAiPicker() { if (!aiPicker.value) refreshAi(); if (!aiSettings.value.preset) { aiPicker.value = false; emit('settings') } else aiPicker.value = !aiPicker.value }
const aiFast = computed(() => supportsFast(aiSettings.value.provider) ? Boolean(aiSettings.value.fast) : undefined)
function confirmPreset() {
  if (!tempModel.value.trim() || !mainSettings.value.presets.some(p => p?.id === tempPreset.value)) return
  saveTranslationChoice(tempPreset.value, tempModel.value, tempEffort.value)
  refreshAi()
  closePicker()
}
function managePresets() { aiPicker.value = false; emit('settings') }

// 新译文出现、或正在翻译的那条变长时，滚到底部。
watch(() => [translator.items.length, translator.items.at(-1)?.result.length], () => {
  void nextTick(() => { const element = list.value; if (element) element.scrollTop = element.scrollHeight })
}, { immediate: true })

function submit() {
  const text = draft.value.trim()
  if (!text) return
  draft.value = ''
  void translate(text)
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); submit() }
  // Esc：预设抽屉开着时先收起抽屉，再按一次才关翻译栏。
  else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (aiPicker.value) aiPicker.value = false; else emit('close') }
}
async function copy(item: Translation) {
  try { await navigator.clipboard.writeText(item.result); copied.value = item.id; setTimeout(() => { if (copied.value === item.id) copied.value = '' }, 1400) } catch { /* 剪贴板不可用时什么也不做 */ }
}
function again(item: Translation) { void translate(item.source, translator.target, true) }
function focus() { void nextTick(() => field.value?.focus()) }
defineExpose({ focus })
</script>

<template>
  <aside class="ai-pane translate-pane" role="complementary" aria-label="翻译助手" @pointerenter="refreshAi" @focusin="refreshAi">
    <header class="tp-header" data-tip="拖动可换到另一侧" @pointerdown="grab">
      <span class="tp-title"><AppIcon name="translate" :size="17" /><span>翻译助手</span></span>
      <div class="tp-targets" role="radiogroup" aria-label="译成">
        <button v-for="item in TARGETS" :key="item.value" type="button" role="radio" :aria-checked="translator.target === item.value" :class="{ on: translator.target === item.value }" @click="translator.target = item.value">{{ item.label }}</button>
      </div>
      <button type="button" class="tp-icon" :disabled="!translator.items.length" aria-label="清空翻译记录" data-tip="清空翻译记录" @click="clearTranslations"><AppIcon name="trash" :size="15" /></button>
      <button type="button" class="tp-icon" aria-label="关闭翻译助手" data-tip="关闭翻译助手" :data-tip-key="shortcut" @click="emit('close')"><AppIcon name="close" :size="15" /></button>
    </header>

    <div ref="list" class="tp-list" data-glass-still>
      <div v-if="!translator.items.length" class="tp-empty">
        <AppIcon name="translate" :size="34" />
        <p>在文档里选中一段文字，右键选「机翻」<template v-if="shortcut">，或按 <kbd>{{ shortcut }}</kbd></template>。</p>
        <p class="tp-muted">也可以把文字粘贴到下面的输入框里。</p>
      </div>
      <article v-for="item in translator.items" :key="item.id" class="tp-card" :class="item.status">
        <p class="tp-source" :title="item.source">{{ item.source }}</p>
        <div class="tp-arrow" aria-hidden="true"><span>{{ item.engine && OLD_ENGINE[item.engine] ? `${OLD_ENGINE[item.engine]} · ` : '' }}{{ LABEL[item.target] }}{{ item.cached ? ' · 刚翻过' : item.ms && item.status === 'done' ? ` · ${(item.ms / 1000).toFixed(1)}s` : '' }}</span></div>
        <div v-if="item.result" class="tp-result" v-html="renderMarkdown(item.result)"></div>
        <p v-else-if="item.status === 'running'" class="tp-pending"><span class="tp-dot"></span><span class="tp-dot"></span><span class="tp-dot"></span></p>
        <p v-if="item.status === 'error'" class="tp-error">{{ item.error || '翻译失败' }}</p>
        <div class="tp-actions">
          <button v-if="item.status === 'running'" type="button" class="tp-icon" aria-label="停止" data-tip="停止" @click="stopTranslation(item.id)"><AppIcon name="stop" :size="14" /></button>
          <template v-else>
            <button type="button" class="tp-icon" :disabled="!item.result" :aria-label="copied === item.id ? '已复制' : '复制译文'" :data-tip="copied === item.id ? '已复制' : '复制译文'" @click="copy(item)"><AppIcon :name="copied === item.id ? 'check' : 'copy'" :size="14" /></button>
            <button type="button" class="tp-icon" aria-label="重新翻译" data-tip="按当前语言重新翻译" @click="again(item)"><AppIcon name="retry" :size="14" /></button>
          </template>
          <button type="button" class="tp-icon" aria-label="删除这条" data-tip="删除这条" @click="removeTranslation(item.id)"><AppIcon name="close" :size="14" /></button>
        </div>
      </article>
    </div>

    <!-- 输入栏与阅读助手同一套：上面是输入框；下面一行左边是「翻译模式」开关（在阅读助手里这个位置是「文档上下文」），
         右边是翻译用的模型预设和发送按钮。点预设按钮，输入栏下沿拉出预设抽屉（齿轮去 设置 → AI 管理）。 -->
    <div class="ai-composer">
      <div ref="composerField" class="composer-field" :class="{ expanded: aiPicker }" @keydown.esc="drawerEscape">
        <textarea ref="field" v-model="draft" placeholder="输入文字，回车翻译" aria-label="要翻译的文字" @keydown="keydown"></textarea>
        <div class="composer-actions">
          <label class="tp-mode" :class="{ on: translator.auto }" :data-tip="translator.auto ? '已开启：选中文字后自动翻译，译文显示在鼠标旁' : '已关闭：选中文字后不自动翻译'"><input v-model="translator.auto" type="checkbox" role="switch" aria-label="翻译模式" /><span class="tp-mode-glyph" aria-hidden="true"><AppIcon name="translate" :size="14" /><i class="tp-mode-slash" /></span><span class="tp-mode-label">翻译模式</span></label>
          <span class="composer-space" />
          <div ref="pickerHost" class="tp-picker-host">
            <button type="button" class="tp-picker" :class="{ empty: !aiSettings.preset }" :aria-expanded="aiPicker" aria-controls="tp-preset-drawer" aria-label="翻译用的模型预设" :data-tip="aiSettings.preset ? [presetTitle(aiSettings.preset), aiLabel, effortLabel].join(' · ') : '还没有模型预设，点这里去 设置 → AI 新建'" @click="toggleAiPicker"><span class="tp-picker-model">{{ aiLabel }}</span><span v-if="effortLabel" class="tp-picker-effort">{{ effortLabel }}</span><AppIcon v-if="aiFast && aiSettings.preset" name="bolt" :size="11" class="tp-picker-fast" /><AppIcon name="down" :size="12" class="tp-picker-chevron" /></button>
          </div>
          <button type="button" class="send-button" :disabled="!draft.trim()" aria-label="开始翻译" data-tip="翻译" data-tip-key="Enter" @click="submit"><AppIcon name="arrow-up" :size="17" /></button>
        </div>
        <div id="tp-preset-drawer" class="composer-drawer" :class="{ open: aiPicker }" :inert="!aiPicker || undefined">
          <ModelPicker v-if="drawerMounted" show-confirm :presets="presetChips" :preset="tempPreset" :model="tempModel" :effort="tempEffort" :models="pickerModels" :editable-model="preview.provider === 'custom'" :confirm-disabled="!tempModel.trim()" @model="chooseModel" @effort="tempEffort = $event" @preset="choosePreset" @manage="managePresets" @confirm="confirmPreset" @close="closePicker" />
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* --frost / --hairline / --bar-glass 与阅读助手同值（暖色极简、草稿风格由 themes.css 里的 .ai-pane 规则覆盖），输入栏因此和阅读助手一模一样。 */
.translate-pane{--frost:color-mix(in srgb,var(--glass-light) 70%,transparent);--frost-hover:color-mix(in srgb,var(--glass-light) 100%,transparent);--hairline:color-mix(in srgb,var(--ink) 11%,transparent);--bar-glass:color-mix(in srgb,var(--glass-light) 78%,transparent);
  container:tp / inline-size;display:flex;flex-direction:column;width:100%;height:100%;min-width:0;background-color:var(--glass-3);background-image:var(--glass-sheen);-webkit-backdrop-filter:var(--glass-filter-3);backdrop-filter:var(--glass-filter-3);border:1px solid var(--glass-outline);border-radius:var(--r-xl);box-shadow:var(--shadow-pane),var(--glass-edge);color:var(--ink);overflow:hidden;font-family:var(--font-ui)}
.tp-header{cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none;display:flex;align-items:center;gap:6px;height:44px;padding:0 8px 0 14px;border-bottom:.5px solid var(--hairline,var(--line-soft));flex-shrink:0}
.tp-title{display:inline-flex;align-items:center;gap:7px;flex:none;font-weight:650;font-size:14px;margin-right:auto;white-space:nowrap}
.tp-targets{display:flex;min-width:0;overflow-x:auto;scrollbar-width:none;gap:2px;padding:2px;border-radius:var(--r-control);background:color-mix(in srgb,var(--surface-ink) 6%,transparent)}
.tp-targets::-webkit-scrollbar{display:none}
.tp-targets button{flex:none;height:24px;padding:0 8px;border:0;border-radius:calc(var(--r-control) - 2px);background:none;box-shadow:none;font-size:11.5px;color:var(--secondary);white-space:nowrap}
.tp-targets button.on{background:var(--surface);color:var(--surface-ink);box-shadow:0 1px 2px rgb(0 0 0 / .12)}
.translate-pane[data-glass-ink='light']{--frost:rgb(255 255 255 / .09);--frost-hover:rgb(255 255 255 / .16);--bar-glass:rgb(255 255 255 / .1);--hairline:rgb(255 255 255 / .12)}
/* 小气泡：尖角朝下，指向输入栏右下角的预设按钮。 */
.tp-hint{position:relative;display:flex;align-items:center;gap:6px;margin:4px 12px 2px;padding:7px 8px 7px 11px;border-radius:10px;background:color-mix(in srgb,var(--accent) 12%,var(--surface));border:1px solid color-mix(in srgb,var(--accent) 28%,transparent);color:var(--surface-ink);font-size:12px;line-height:1.45}
.tp-hint::after{content:'';position:absolute;right:76px;bottom:-6px;width:10px;height:10px;background:inherit;border-right:inherit;border-bottom:inherit;rotate:45deg;border-radius:0 0 3px 0}
.tp-hint .tp-link{flex:none;margin-left:auto}
.tp-hint-close{display:grid;place-items:center;flex:none;width:20px;height:20px;padding:0;border:0;border-radius:50%;background:none;box-shadow:none;color:var(--muted)}
.tp-hint-close:hover{background:color-mix(in srgb,var(--surface-ink) 8%,transparent);color:var(--ink)}
.tp-hint-enter-active{transition:opacity var(--dur-2) var(--ease-soft),translate var(--dur-3) var(--spring-snappy)}
.tp-hint-leave-active{transition:opacity var(--dur-1) var(--ease-soft)}
.tp-hint-enter-from{opacity:0;translate:0 6px}.tp-hint-leave-to{opacity:0}
.tp-icon{display:grid;place-items:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:none;box-shadow:none;color:var(--secondary)}
.tp-icon:hover:not(:disabled){background:color-mix(in srgb,var(--surface-ink) 8%,transparent);color:var(--ink)}
.tp-icon:disabled{opacity:.4}
.tp-list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:8px 8px 2px;will-change:transform}
.tp-empty{display:grid;justify-items:center;gap:8px;margin-top:22vh;padding:0 18px;text-align:center;color:var(--secondary);font-size:13px;line-height:1.6}
.tp-empty p{margin:0}
.tp-muted{color:var(--muted)}
.tp-empty kbd{padding:1px 5px;border-radius:5px;background:color-mix(in srgb,var(--surface-ink) 8%,transparent);font-size:11px}
.tp-card{position:relative;margin-bottom:8px;padding:8px 11px 9px;border-radius:12px;background:color-mix(in srgb,var(--surface) 72%,transparent);border:.5px solid var(--line-soft);animation:tp-in var(--dur-3) var(--spring-snappy) backwards}
@keyframes tp-in{from{opacity:0;translate:0 10px;scale:.98}}
.tp-source{margin:0;color:var(--secondary);font-size:12.5px;line-height:1.55;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap}
.tp-arrow{display:flex;align-items:center;gap:8px;margin:5px 0 3px;color:var(--muted);font-size:10.5px;letter-spacing:.04em}
.tp-arrow::before,.tp-arrow::after{content:'';flex:1;height:.5px;background:var(--line-soft)}
.tp-result{font-family:var(--font-answer,var(--font-reading));font-size:14.5px;line-height:1.6;overflow-wrap:anywhere}
.tp-result :deep(p){margin:0 0 .6em}
.tp-result :deep(>:last-child){margin-bottom:0}
.tp-pending{display:flex;gap:5px;margin:6px 0 2px}
.tp-dot{width:6px;height:6px;border-radius:50%;background:var(--muted);animation:tp-blink 1.1s ease-in-out infinite}
.tp-dot:nth-child(2){animation-delay:.15s}.tp-dot:nth-child(3){animation-delay:.3s}
@keyframes tp-blink{0%,100%{opacity:.25}50%{opacity:1}}
.tp-error{margin:4px 0 0;color:var(--danger);font-size:12px}
/* 操作按钮不占一行：浮在卡片右下角，指到卡片上才出现。 */
.tp-actions{position:absolute;right:5px;bottom:4px;display:flex;gap:1px;padding:1px;border-radius:9px;background:var(--surface);box-shadow:0 0 0 .5px var(--line-soft),0 2px 8px rgb(0 0 0 / .1);opacity:0;pointer-events:none;transition:opacity var(--dur-1) var(--ease-soft)}
.tp-card:hover .tp-actions,.tp-card:focus-within .tp-actions,.tp-card.running .tp-actions{opacity:1;pointer-events:auto}
.tp-actions .tp-icon{width:26px;height:24px}
.tp-link{margin-left:auto;padding:0;border:0;background:none;box-shadow:none;color:var(--secondary);font-size:11.5px;text-decoration:underline;text-underline-offset:2px}
/* ---- 输入栏：以下照搬阅读助手（AiPane.vue）的输入栏样式，类名 ai-composer / composer-field / send-button 也相同，
   所以 themes.css 里暖色极简、草稿风格对输入栏的改写会同样作用到这里。开关与预设按钮用 tp- 前缀，免得界面检查脚本里
   document.querySelector('.ai-pane .context-switch') 一类的选择器选中翻译栏。 ---- */
.ai-composer{position:relative;flex-shrink:0;padding:6px 10px 10px;container:composer / inline-size}
.composer-field{position:relative;border:1px solid var(--hairline);border-radius:var(--r-lg);background:var(--bar-glass);box-shadow:inset 0 1px 0 var(--glass-rim-soft),0 1px 2px rgb(0 0 0 / .04);transition:border-color var(--dur-2) var(--ease-out),background var(--dur-2) var(--ease-out)}
.composer-field:focus-within{border-color:color-mix(in srgb,var(--ink) 24%,transparent)}
/* 输入框：空着时与阅读助手默认高度相同（76px），译文较长时随内容长高，最多 200px 后出现滚动。 */
.composer-field textarea{box-sizing:border-box;display:block;width:100%;min-height:76px;max-height:200px;field-sizing:content;padding:12px 14px 4px;resize:none;border:0;border-radius:var(--r-lg) var(--r-lg) 0 0;background:transparent;box-shadow:none;color:var(--ink);font:inherit;font-family:var(--font-ui);font-size:13.5px;line-height:1.65;outline:none}
.composer-field textarea:hover:not(:focus),.composer-field textarea:focus{background:transparent;border:0;box-shadow:none}
.composer-field textarea::placeholder{color:var(--muted);font-family:'Anthropic Serif','Source Han Serif SC','Noto Serif CJK SC','Songti SC','SimSun',var(--font-ui);letter-spacing:.02em}
.composer-actions{display:flex;align-items:center;gap:6px;min-width:0;padding:4px 8px 8px}
.composer-space{flex:1}
/* 翻译模式：与「文档上下文」同一枚圆角方块开关。关闭时是安静的描边译字图标，上面划一道斜线；开启时整枚带上主色的玻璃底，
   图标与文字变成主色，斜线收起。 */
.tp-mode{--context-on:var(--accent);position:relative;display:inline-flex;align-items:center;gap:6px;min-width:0;flex-shrink:0;height:30px;padding:0 11px 0 9px;border:1px solid transparent;border-radius:var(--r-control);background:transparent;font-size:12px;font-weight:550;color:var(--muted);cursor:pointer;white-space:nowrap;transition:background var(--dur-2) var(--ease-out),border-color var(--dur-2) var(--ease-out),color var(--dur-2) var(--ease-out),box-shadow var(--dur-2) var(--ease-out),transform var(--dur-press) var(--spring-press)}
.tp-mode input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer}
.tp-mode:hover{background:var(--frost);color:var(--secondary)}
.tp-mode:active{transform:scale(.96)}
.tp-mode.on{border-color:color-mix(in srgb,var(--context-on) 34%,transparent);background:color-mix(in srgb,var(--context-on) 15%,transparent);color:var(--context-on);font-weight:650;box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 35%,transparent),0 3px 10px -6px color-mix(in srgb,var(--context-on) 70%,transparent)}
.tp-mode.on:hover{background:color-mix(in srgb,var(--context-on) 21%,transparent)}
.tp-mode:focus-within{box-shadow:0 0 0 2px var(--accent-ring)}
.tp-mode-glyph{position:relative;display:grid;place-items:center;flex-shrink:0;width:16px;height:16px;pointer-events:none}
.tp-mode-glyph svg{transition:transform var(--dur-bounce) var(--spring-bouncy)}
.tp-mode.on .tp-mode-glyph svg{transform:scale(1.08)}
.tp-mode-slash{position:absolute;left:50%;top:50%;width:19px;height:1.6px;margin:-.8px 0 0 -9.5px;border-radius:2px;background:currentColor;box-shadow:0 0 0 1.2px var(--bar-glass);transform:rotate(-45deg) scaleX(1);transition:transform var(--dur-3) var(--spring-snappy),opacity var(--dur-2) var(--ease-out)}
.tp-mode.on .tp-mode-slash{opacity:0;transform:rotate(-45deg) scaleX(0)}
.tp-mode-label{min-width:0;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
:root:not([data-theme='dark']) .translate-pane[data-glass-ink='light'] .tp-mode{--context-on:color-mix(in srgb,var(--accent) 45%,#fff)}
:root[data-theme='dark'] .translate-pane[data-glass-ink='dark'] .tp-mode{--context-on:color-mix(in srgb,var(--accent) 60%,#000)}
/* 预设按钮：与阅读助手的模型按钮同样式。 */
.tp-picker-host{position:relative;min-width:0;display:flex}
.tp-picker{display:flex;align-items:center;gap:6px;min-width:64px;max-width:190px;flex-shrink:1;height:30px;padding:0 9px 0 11px;border:1px solid transparent;border-radius:var(--r-control);background:none;box-shadow:none;font:inherit;font-size:12px;color:var(--secondary);cursor:pointer}
.tp-picker:hover:not(:disabled),.tp-picker[aria-expanded='true']{background:var(--frost);border-color:var(--hairline);color:var(--ink)}
.tp-picker-model{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.tp-picker.empty .tp-picker-model{color:var(--accent)}
.tp-picker-effort{flex:0 0 auto;font-weight:500;color:var(--muted)}
.tp-picker-fast{flex:none;margin-left:-2px;color:var(--accent)}
.tp-picker-chevron{flex:0 0 auto;opacity:.55;transition:transform var(--dur-3) var(--spring-snappy)}
.tp-picker[aria-expanded='true'] .tp-picker-chevron{transform:rotate(180deg)}
.send-button{display:grid;place-items:center;flex:0 0 32px;width:32px;height:32px;padding:0;border:1px solid transparent;border-radius:var(--r-control);background:color-mix(in srgb,var(--accent) 84%,transparent);box-shadow:inset 0 1px 0 rgb(255 255 255 / .25);color:var(--accent-on,#fff);cursor:pointer;transition:transform var(--dur-press) var(--spring-press),opacity var(--dur-1) var(--ease-soft),background var(--dur-1) var(--ease-soft)}
.send-button:hover:not(:disabled){background:var(--accent);color:var(--accent-on,#fff);transform:scale(1.05)}
.send-button:active:not(:disabled){transform:scale(.94)}
.send-button:disabled{background:var(--frost);border-color:var(--hairline);color:var(--muted);box-shadow:none;opacity:1;cursor:default}
/* 预设抽屉：高度从 0 弹到内容高度，内容随之从上方滑入、淡入（同阅读助手）。 */
.composer-drawer{interpolate-size:allow-keywords;height:0;overflow:hidden;padding:0 8px;opacity:0;transition:height var(--dur-bounce) var(--spring-snappy),opacity var(--dur-2) var(--ease-out)}
.composer-drawer.open{height:auto;opacity:1}
.composer-drawer>*{translate:0 -10px;transition:translate var(--dur-bounce) var(--spring-snappy)}
.composer-drawer.open>*{translate:0 0}
.composer-drawer:not(.open){visibility:hidden;transition:height var(--dur-spring) var(--spring-snappy),opacity var(--dur-1) var(--ease-out),visibility 0s linear var(--dur-spring)}
/* 输入栏很窄时，开关只留图标，预设按钮先让出宽度。 */
@container composer (max-width: 300px){.tp-mode{flex-shrink:1}}
@container composer (max-width: 260px){.tp-mode-label{display:none}.tp-mode{padding:0 7px}}
/* 栏窄的时候：标题只留图标，按钮收紧；再窄语言可以横向滑动，右边的清空、关闭始终在。 */
@container tp (max-width:360px){.tp-title span{display:none}.tp-targets button{padding:0 6px}.tp-header{padding-left:10px}}
@media(prefers-reduced-motion:reduce){.tp-card,.tp-dot{animation:none}.composer-drawer,.composer-drawer>*{transition:none}}
</style>
