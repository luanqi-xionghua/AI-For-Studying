<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppIcon from '../ui/AppIcon.vue'

// 输入栏下沿拉出的抽屉：最上面一行是模型预设（有两个以上预设时），然后是模型（可横向滑动的胶囊），最下面是思考强度滑杆。
// 服务商、密钥与预算都在设置里；预设行右侧的齿轮打开 设置 → AI。
type Model = { id: string; name: string; efforts?: string[]; defaultEffort?: string }
type PresetChip = { id: string; name: string; detail?: string }
// fast：服务商支持优先通道（Codex / OpenAI）时才传，undefined 就不显示开关。
const props = withDefaults(defineProps<{ model: string; effort: string; models: Model[]; loading?: boolean; error?: string; canRefresh?: boolean; fast?: boolean
  /** 不提供「默认」档：翻译要明确的思考强度。 */
  noDefault?: boolean
  /** 可切换的模型预设与当前选中的那个。 */
  presets?: PresetChip[]; preset?: string
  confirmDisabled?: boolean
  /** 显示确定按钮（用于预设选择需要确认的场景）。 */
  showConfirm?: boolean }>(), { fast: undefined })
const emit = defineEmits<{ model: [id: string]; effort: [value: string]; fast: [value: boolean]; refresh: []; close: []; preset: [id: string]; manage: []; confirm: [] }>()
const EFFORT_LABELS: Record<string, string> = { '': '默认', none: '关', minimal: '极简', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高', ultra: '极致' }
const showPresets = computed(() => Boolean(props.presets?.length) && (props.showConfirm || props.presets!.length > 1))
const root = ref<HTMLElement>()
const current = computed(() => props.models.find(item => item.id === props.model))
const steps = computed(() => [...(props.noDefault ? [] : ['']), ...(current.value?.efforts || ['none', 'low', 'medium', 'high', 'xhigh']).filter(Boolean)])
const index = computed(() => Math.max(0, steps.value.indexOf(props.effort)))
const label = (value: string) => EFFORT_LABELS[value] ?? value
function key(event: KeyboardEvent) {
  const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0
  if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); emit('effort', steps.value[event.key === 'Home' ? 0 : steps.value.length - 1]); return }
  if (!delta) return
  event.preventDefault()
  emit('effort', steps.value[Math.min(steps.value.length - 1, Math.max(0, index.value + delta))])
}
// 胶囊行（预设、模型）：左右方向键在胶囊间移动，竖向滚轮横向滚动这一行。
function chipKey(event: KeyboardEvent) {
  const strip = event.currentTarget as HTMLElement
  const buttons = [...strip.querySelectorAll<HTMLButtonElement>('button')]
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  if (!delta || at < 0) return
  event.preventDefault()
  buttons[Math.min(buttons.length - 1, Math.max(0, at + delta))]?.focus()
}
function chipWheel(event: WheelEvent) {
  const strip = event.currentTarget as HTMLElement
  if (event.ctrlKey || !event.deltaY || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
  const max = strip.scrollWidth - strip.clientWidth
  if (max <= 0 || (event.deltaY < 0 ? strip.scrollLeft <= 0 : strip.scrollLeft >= max - 1)) return
  const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? strip.clientWidth : 1
  event.preventDefault()
  strip.scrollBy({ left: event.deltaY * unit, behavior: 'instant' })
}
function escape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  event.preventDefault(); event.stopPropagation()
  emit('close')
}
onMounted(() => root.value?.querySelectorAll<HTMLElement>('.model-chips [aria-selected="true"], .preset-chips [aria-checked="true"]').forEach(chip => chip.scrollIntoView({ block: 'nearest', inline: 'center' })))
</script>

<template>
  <div ref="root" class="model-drawer" role="group" aria-label="模型与思考强度" @keydown="escape">
    <div v-if="showPresets" class="drawer-row preset-row">
      <span class="drawer-label">预设</span>
      <!-- 预设只能选一个：用单选组，和下面的模型胶囊（listbox）分开。 -->
      <div class="preset-chips" role="radiogroup" aria-label="模型预设" @keydown="chipKey" @wheel="chipWheel">
        <button v-for="item in presets" :key="item.id" type="button" role="radio" :aria-checked="item.id === preset" :tabindex="item.id === preset ? 0 : -1" :data-tip="item.detail" @click="emit('preset', item.id)">{{ item.name }}</button>
      </div>
      <button type="button" class="drawer-icon" data-tip="管理模型预设（设置 → AI）" aria-label="管理模型预设" @click="emit('manage')"><AppIcon name="settings" :size="13" /></button>
      <button v-if="showConfirm" type="button" class="drawer-confirm" :disabled="confirmDisabled" data-tip="确定" aria-label="确定" @click="emit('confirm')">确定</button>
    </div>
    <div class="drawer-row">
      <span class="drawer-label">模型</span>
      <div class="model-chips" role="listbox" aria-label="模型" aria-orientation="horizontal" @keydown="chipKey" @wheel="chipWheel">
        <button v-for="item in models" :key="item.id || 'default'" type="button" role="option" :aria-selected="item.id === model" :tabindex="item.id === model ? 0 : -1" @click="emit('model', item.id)">{{ item.name || item.id }}</button>
        <span v-if="loading" class="chips-note">正在读取本机模型…</span>
      </div>
      <button v-if="canRefresh" type="button" class="drawer-icon" :disabled="loading" data-tip="重新读取本机模型" aria-label="重新读取本机模型" @click="emit('refresh')"><AppIcon name="reset" :size="13" /></button>
    </div>
    <div class="drawer-row">
      <span class="drawer-label">思考</span>
      <!-- 分段选择：每一档直接写出名字，选中的那一档下面滑过一块玻璃；档位越高，旁边的强度格亮得越多。 -->
      <div class="effort-segments" role="radiogroup" aria-label="思考强度" :style="{ '--count': steps.length, '--index': index }" @keydown="key">
        <span class="effort-thumb" aria-hidden="true" />
        <button v-for="(step, i) in steps" :key="step || 'default'" type="button" role="radio" :aria-checked="i === index" :tabindex="i === index ? 0 : -1" :class="{ on: i === index }" :data-tip="step ? undefined : '使用模型默认强度'" @click="emit('effort', step)">{{ label(step) }}</button>
      </div>
      <span class="effort-meter" aria-hidden="true" :title="label(effort)"><i v-for="bar in 4" :key="bar" :class="{ lit: index > 0 && bar <= Math.ceil(index / Math.max(1, steps.length - 1) * 4) }" /></span>
      <button v-if="fast !== undefined" type="button" class="fast-toggle" :class="{ on: fast }" role="switch" :aria-checked="fast" aria-label="Fast" :data-tip="fast ? 'Fast 已开：更快，额度消耗更多' : 'Fast：更快出字，额度消耗更多'" @click="emit('fast', !fast)"><AppIcon name="bolt" :size="12" />Fast</button>
    </div>
    <p v-if="error" class="drawer-status" role="status">{{ error }}</p>
  </div>
</template>

<style scoped>
/* 抽屉在输入栏玻璃之内，用输入栏自己的墨色；两行之间只有很轻的分隔。 */
.model-drawer{display:grid;gap:4px;padding:8px 2px 2px;border-top:1px solid var(--hairline);color:var(--ink);font-family:var(--font-ui)}
button{font:inherit;color:inherit;cursor:pointer}
.drawer-row{display:flex;align-items:center;gap:8px;min-width:0;height:32px}
.drawer-confirm:disabled{opacity:.5;cursor:not-allowed}
.drawer-label{flex:0 0 auto;width:28px;font-size:11.5px;font-weight:600;color:var(--muted)}
.model-chips,.preset-chips{display:flex;align-items:center;gap:4px;flex:1;min-width:0;overflow-x:auto;overflow-y:hidden;padding:0 10px 0 6px}
.model-chips{height:32px;scrollbar-width:none;scroll-behavior:smooth;mask:linear-gradient(90deg,transparent,#000 10px,#000 calc(100% - 14px),transparent)}
.model-chips::-webkit-scrollbar{display:none}
/* 只让胶囊区滚动；原生滚动条溢出时占位，不挤压按钮，也不滚走设置和确定。 */
.preset-row{height:auto;min-height:32px}
.preset-chips{padding:3px 6px}
.preset-chips::-webkit-scrollbar{height:8px}
.preset-chips::-webkit-scrollbar-thumb{border-width:1px}
.model-chips button,.preset-chips button{flex:0 0 auto;height:26px;padding:0 11px;border:1px solid transparent;border-radius:var(--r-sm);background:none;box-shadow:none;font-size:12px;font-weight:550;color:var(--secondary);white-space:nowrap;transition:background var(--dur-1) var(--ease-soft),color var(--dur-1) var(--ease-soft),transform var(--dur-press) var(--spring-press)}
.model-chips button:hover,.preset-chips button:hover{background:var(--frost);color:var(--ink)}
.model-chips button:active,.preset-chips button:active{transform:scale(.96)}
.model-chips button[aria-selected='true'],.preset-chips button[aria-checked='true']{background:var(--frost-hover);border-color:var(--hairline);color:var(--ink);font-weight:650;box-shadow:inset 0 1px 0 var(--glass-rim-soft),0 2px 6px -3px rgb(0 0 0 / .3)}
.chips-note{flex:0 0 auto;font-size:11px;color:var(--muted)}
.drawer-icon{display:grid;place-items:center;flex-shrink:0;width:26px;height:26px;padding:0;border:0;border-radius:var(--r-xs);background:none;box-shadow:none;color:var(--muted)}
.drawer-icon:hover:not(:disabled){background:var(--frost);color:var(--ink)}
.drawer-icon:disabled{opacity:.35;cursor:default}
/* 确定按钮：预设选择时的确认按钮 */
.drawer-confirm{flex-shrink:0;height:26px;padding:0 12px;border:1px solid transparent;border-radius:var(--r-sm);background:color-mix(in srgb,var(--accent) 84%,transparent);box-shadow:inset 0 1px 0 rgb(255 255 255 / .25);color:var(--accent-on,#fff);font-size:12px;font-weight:650;transition:background var(--dur-1) var(--ease-soft),transform var(--dur-press) var(--spring-press)}
.drawer-confirm:hover{background:var(--accent);transform:scale(1.02)}
.drawer-confirm:active{transform:scale(.96)}
/* 思考强度：一排分段，选中的一档下面是一块随弹簧滑动的玻璃；右侧四格信号条表示当前强度。 */
.effort-segments{--count:5;--index:0;position:relative;display:grid;grid-template-columns:repeat(var(--count),1fr);flex:1;min-width:0;height:28px;padding:2px;border-radius:var(--r-sm);background:color-mix(in srgb,var(--ink) 6%,transparent);box-shadow:inset 0 1px 2px rgb(0 0 0 / .08)}
.effort-thumb{position:absolute;top:2px;bottom:2px;left:calc(2px + (100% - 4px) / var(--count) * var(--index));width:calc((100% - 4px) / var(--count));border-radius:calc(var(--r-sm) - 2px);background:var(--frost-hover);background-image:linear-gradient(180deg,rgb(255 255 255 / .55),rgb(255 255 255 / .15));box-shadow:0 1px 4px -1px rgb(0 0 0 / .22),inset 0 0 0 .5px var(--hairline),inset 0 1px 0 var(--glass-rim-soft);transition:left var(--dur-smooth) var(--spring-snappy)}
.effort-segments button{position:relative;z-index:1;min-width:0;height:100%;padding:0 2px;border:0;border-radius:calc(var(--r-sm) - 2px);background:none;box-shadow:none;font-size:11.5px;font-weight:550;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color var(--dur-1) var(--ease-soft),transform var(--dur-press) var(--spring-press)}
.effort-segments button:hover:not(.on){color:var(--ink)}
.effort-segments button:active{transform:scale(.94)}
.effort-segments button.on{color:var(--ink);font-weight:650}
.effort-segments button:focus-visible{outline:none;box-shadow:0 0 0 2px var(--accent-ring)}
.effort-meter{display:flex;align-items:flex-end;gap:2px;flex:0 0 auto;height:14px;margin:0 4px 0 2px}
.effort-meter i{width:3px;border-radius:1px;background:color-mix(in srgb,var(--ink) 16%,transparent);transition:background var(--dur-2) var(--ease-out)}
.effort-meter i:nth-child(1){height:5px}.effort-meter i:nth-child(2){height:8px}.effort-meter i:nth-child(3){height:11px}.effort-meter i:nth-child(4){height:14px}
.effort-meter i.lit{background:var(--accent)}
.fast-toggle{display:inline-flex;align-items:center;gap:3px;flex:0 0 auto;height:26px;padding:0 8px;border:1px solid transparent;border-radius:var(--r-sm);background:none;box-shadow:none;font-size:11.5px;font-weight:600;color:var(--muted);transition:background var(--dur-1) var(--ease-soft),color var(--dur-1) var(--ease-soft)}
.fast-toggle:hover{background:var(--frost);color:var(--ink)}
.fast-toggle.on{background:color-mix(in srgb,var(--accent) 14%,transparent);border-color:color-mix(in srgb,var(--accent) 30%,transparent);color:var(--accent)}
.drawer-status{margin:0 0 2px 36px;font-size:11px;color:var(--muted)}
@media(prefers-reduced-motion:reduce){.effort-thumb,.model-chips button,.preset-chips button{transition:none}.model-chips,.preset-chips{scroll-behavior:auto}}
</style>
