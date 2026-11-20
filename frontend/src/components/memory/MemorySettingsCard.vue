<script setup lang="ts">
import { computed } from 'vue'
import { relativeTime } from '../../memory/prompts.ts'
import { todayKey } from '../../memory/scheduler.ts'

const props = defineProps<{ state: any }>()
const emit = defineEmits<{ settings: []; retry: []; stop: []; resume: []; toggle: [value: boolean] }>()

const settings = computed<any>(() => props.state?.settings ?? {})
const config = computed<any>(() => props.state?.config ?? { configured: false, presetTitle: '', modelName: '', effort: '', effortName: '', high: false, message: '' })
const running = computed<any>(() => props.state?.running ?? null)
const lastRun = computed<any>(() => props.state?.index?.lastRun ?? null)
const rebuilding = computed(() => Boolean(props.state?.rebuilding))
const highNote = '当前为高强度，自动记忆更新可能消耗较多额度。'
const autoUpdate = computed(() => settings.value.autoUpdate !== false)
const targetLabel = (kind: string, title: string) => kind === 'doc' ? `《${title || '文档'}》` : '全局记忆'
const budgetToday = computed(() => settings.value.budget?.day === todayKey(Date.now()) ? (settings.value.budget?.runs || 0) : 0)
const clockText = computed(() => {
  const at = settings.value.pausedUntil || 0
  if (!at) return ''
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
})
const statusText = computed(() => {
  if (running.value) return `正在更新${targetLabel(running.value.kind, running.value.title)}的记忆…`
  if (settings.value.pausedUntil) return `连续失败 3 次，自动更新已暂停到 ${clockText.value}。`
  if (lastRun.value && !lastRun.value.ok) return `上次更新失败（${targetLabel(lastRun.value.kind, lastRun.value.title)}）：${lastRun.value.error}`
  if (lastRun.value) return `上次更新：${relativeTime(lastRun.value.at, Date.now())} · ${targetLabel(lastRun.value.kind, lastRun.value.title)}`
  return '还没有进行过记忆总结。'
})
function toggle(event: Event) { emit('toggle', (event.target as HTMLInputElement).checked) }
</script>

<template>
  <section class="memory-settings page-card" aria-label="记忆设置">
    <div class="memory-settings-main">
      <label class="memory-switch">
        <span>自动更新记忆</span>
        <input type="checkbox" role="switch" aria-label="自动更新记忆" :checked="autoUpdate" @change="toggle" />
      </label>
      <p class="memory-settings-help">对话结束后在后台整理：每 3 轮问答一次，同一本书至少间隔 10 分钟，每天最多 40 次。关闭后只在你点「重新总结」时更新。</p>
      <div class="memory-preset-row">
        <template v-if="config.configured">
          <span class="memory-preset-text">记忆总结使用：{{ config.presetTitle }} · {{ config.modelName }} · 思考强度 {{ config.effortName }}</span>
          <button type="button" class="text-button" @click="emit('settings')">去 设置 → AI 修改</button>
        </template>
        <template v-else>
          <span class="memory-preset-text">{{ config.message || (config.presetTitle ? '记忆管理用的模型预设没有选模型' : '未配置记忆管理预设') }}</span>
          <button type="button" class="text-button" @click="emit('settings')">去 设置 → AI → 各处默认预设 选择</button>
        </template>
      </div>
      <p v-if="config.high" class="memory-high" role="status">{{ highNote }}</p>
      <div class="memory-status-row">
        <span class="memory-status" role="status">{{ statusText }}</span>
        <button v-if="running" type="button" class="text-button" @click="emit('stop')">停止</button>
        <button v-else-if="settings.pausedUntil" type="button" class="text-button" @click="emit('resume')">立即恢复</button>
        <button v-else-if="lastRun && !lastRun.ok" type="button" class="text-button" @click="emit('retry')">重试</button>
        <span class="memory-budget">今天已自动更新 {{ budgetToday }} 次</span>
      </div>
      <p v-if="budgetToday >= 40" class="memory-warning">今天的自动更新已达 40 次上限，明天恢复；手动「重新总结」不受影响。</p>
      <p v-if="rebuilding" class="memory-warning" role="status">正在重建记忆索引…</p>
      <p class="memory-privacy">学习记忆只保存在这台电脑的文档库里。只有你在实际用到记忆的功能里，相应的记忆片段才会随请求发给你自己配置的模型服务商：记忆总结、对话模式、阅读助手、翻译、快速解释和猜你想问；不会发送整本书的内容。</p>
    </div>
  </section>
</template>

<style scoped>
.memory-settings { display: flex; flex-direction: column; gap: 8px; }
.memory-settings-main { display: flex; flex-direction: column; gap: 8px; }
.memory-switch { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13.5px; font-weight: 650; color: var(--control-ink, var(--ink)); cursor: pointer; }
.memory-switch input { margin: 0; }
.memory-settings-help { margin: 0; font-size: 12px; line-height: 1.7; color: var(--muted); }
.memory-preset-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-size: 12.5px; }
.memory-preset-text { color: var(--secondary); }
.memory-high, .memory-warning { margin: 0; font-size: 12px; line-height: 1.6; color: var(--warning); }
.memory-status-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12.5px; }
.memory-status { color: var(--secondary); }
.memory-budget { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; }
.memory-privacy { margin: 2px 0 0; font-size: 11.5px; line-height: 1.7; color: var(--muted); }
.text-button { border: 0; border-radius: var(--r-control); background: none; box-shadow: none; color: var(--accent); padding: 3px 8px; font-size: 12.5px; cursor: pointer; }
.text-button:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
</style>
