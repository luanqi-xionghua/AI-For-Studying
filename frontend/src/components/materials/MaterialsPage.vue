<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '../ui/AppIcon.vue'
import ConfirmDialog from '../ui/ConfirmDialog.vue'
import MaterialResultRow from './MaterialResultRow.vue'
import { materials } from '../../materials/index.ts'
import type { MaterialLink } from '../../materials/types.ts'
import { relativeTime } from '../../memory/prompts.ts'

const props = defineProps<{ settingsVersion: number }>()
const emit = defineEmits<{
  settings: []
  notify: [text: string]
  'open-document': [id: string]
}>()

const EXAMPLES = ['计算机网络 期末试卷', '线代 课后答案', '数据库 期中', '概率论 笔记', '编译原理 课件']

const input = ref<HTMLInputElement | null>(null)
const menuOpen = ref(false)
const sourcesOpen = ref(false)
const confirmClear = ref<'clear' | 'resync' | null>(null)

const state = materials.state
const view = materials.view
const status = materials.statusView
const banner = materials.banner

function focusSearch() {
  input.value?.focus()
  input.value?.select()
}

onMounted(async () => {
  await materials.init()
  focusSearch()
})
watch(() => props.settingsVersion, () => materials.refreshRerankAvailability())
onBeforeUnmount(() => materials.dispose())

const withinMinute = computed(() => {
  const synced = status.value.syncedAt
  return Boolean(synced) && Date.now() - synced < 60_000
})

const syncDisabled = computed(() => state.sync.running || withinMinute.value)

const syncButtonLabel = computed(() => {
  if (state.sync.running) return '同步中…'
  if (withinMinute.value) return '刚刚更新过'
  return status.value.state === 'empty' ? '同步资料索引' : '更新索引'
})

const statusLine = computed(() => {
  const current = status.value
  if (current.state !== 'ready') return '还没有同步资料索引'
  if (state.sync.running) return '正在同步资料索引…'
  const total = current.total.toLocaleString('en-US')
  if (current.stale && current.syncedAt) {
    const days = Math.max(1, Math.floor((Date.now() - current.syncedAt) / 86_400_000))
    return `索引共 ${total} 条 · 已 ${days} 天没有更新`
  }
  return `索引共 ${total} 条 · 更新于 ${relativeTime(current.syncedAt, Date.now())}`
})

const result = computed(() => state.search.result)

const countLabel = computed(() => {
  const current = result.value
  if (!current) return ''
  return current.total > current.results.length
    ? `共 ${current.total} 条，显示前 ${current.results.length} 条`
    : `共 ${current.total} 条`
})

const canCancel = computed(() => state.sync.running && !state.sync.cancelling && !state.sync.committing)

const cancelLabel = computed(() => {
  if (state.sync.committing) return '正在写入，马上完成'
  if (state.sync.cancelling) return '取消中…'
  return '取消'
})

const rerankLine = computed(() => {
  switch (state.rerank.status) {
    case 'running': return 'AI 正在挑选最相关的几条…'
    case 'done': return `前 ${state.rerank.order?.length ?? 0} 条已由 AI 重新排序，并附上理由。`
    case 'failed': return 'AI 排序没有完成，已按本地相关度排序。'
    case 'off': return '按本地相关度排序（AI 辅助已关闭）。'
    case 'unavailable':
      return state.rerank.unavailableReason === 'no-model'
        ? '按本地相关度排序。阅读助手用的预设还没有选模型。'
        : '按本地相关度排序。配置 AI 预设后，可让模型挑选并说明理由。'
    default: return ''
  }
})

const showSettingsHint = computed(() => state.rerank.status === 'unavailable')

const progressPercent = computed(() => {
  if (!state.sync.total) return 0
  return Math.min(100, Math.round((state.sync.done / state.sync.total) * 100))
})

const clearMessage = computed(() => {
  const total = status.value.total.toLocaleString('en-US')
  return `会删除本机缓存的 ${total} 条资料目录，不影响文档库、学习记忆和其他数据。清空后需要重新同步才能搜索网络资料。`
})

const hasHint = (key: string) => Boolean(result.value?.hints?.includes(key as never))

function submit() {
  void materials.submit()
}

function onEsc() {
  if (state.draft) materials.clearQuery()
  else input.value?.blur()
}

function runQuery(text: string) {
  state.draft = text
  void materials.submit(text)
}

async function openLink(link: MaterialLink) {
  const message = await materials.open(link)
  if (message) emit('notify', message)
}

async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url)
    emit('notify', '已复制链接。')
  } catch {
    emit('notify', '复制失败，请手动选择链接。')
  }
}

async function doClear() {
  const resync = confirmClear.value === 'resync'
  confirmClear.value = null
  const message = await materials.clearIndex()
  if (message) {
    emit('notify', message)
    return
  }
  emit('notify', '已清空本地资料索引。')
  if (resync) void materials.startSync()
}

function toggleMenu() {
  menuOpen.value = !menuOpen.value
  if (!menuOpen.value) sourcesOpen.value = false
}

function closeMenu() {
  menuOpen.value = false
  sourcesOpen.value = false
}

function onToggleAi(event: Event) {
  const target = event.target as HTMLInputElement | null
  materials.setAiRerank(Boolean(target?.checked))
}
</script>

<template>
  <section class="page-view materials-page" aria-label="资料检索">
    <header class="page-heading materials-heading">
      <h1>资料检索</h1>
      <div class="materials-head-info">
        <p class="page-note">
          输入课程或关键词，从 OpenISE、SYSU-Exam 和破壁计划的公开资料里找试卷、答案、笔记和课件。结果只给链接，点开用系统浏览器查看。
        </p>
        <p class="materials-status" role="status">{{ statusLine }}</p>
      </div>
      <div class="materials-head-actions">
        <button type="button" class="head-button" :disabled="syncDisabled" @click="materials.startSync()">
          <AppIcon name="reset" :size="14" />{{ syncButtonLabel }}
        </button>
        <div class="materials-menu-wrap">
          <button type="button" class="head-button icon-only" aria-haspopup="menu" :aria-expanded="menuOpen"
                  aria-label="更多操作" data-tip="更多操作" @click="toggleMenu">
            <AppIcon name="more" :size="14" />
          </button>
          <div v-if="menuOpen" class="materials-menu" role="menu" @keydown.esc="closeMenu">
            <button type="button" role="menuitem" :disabled="state.sync.running" @click="closeMenu(); confirmClear = 'clear'">
              清空本地索引
            </button>
            <button type="button" role="menuitem" :disabled="state.sync.running" @click="closeMenu(); confirmClear = 'resync'">
              清空并重新同步
            </button>
            <button type="button" role="menuitem" :aria-expanded="sourcesOpen" @click="sourcesOpen = !sourcesOpen">
              资料来源说明
            </button>
            <div v-if="sourcesOpen" class="materials-sources">
              <p v-for="source in status.sources" :key="source.key">
                {{ source.label }} · {{ source.count.toLocaleString('en-US') }} 条 · {{ relativeTime(source.syncedAt, Date.now()) }}
              </p>
              <p v-if="!status.sources.length" class="materials-sources-empty">还没有同步过。</p>
              <p class="materials-sources-note">资料版权归原作者和原站点所有，本应用只保存目录并给出链接。</p>
            </div>
          </div>
        </div>
      </div>
    </header>

    <div v-if="banner" class="materials-banner" :class="banner.tone" :role="banner.tone === 'error' ? 'alert' : 'status'">
      <span class="materials-banner-text">{{ banner.text }}</span>
      <span class="materials-banner-actions">
        <button v-if="banner.kind === 'progress' && canCancel" type="button" class="banner-button" @click="materials.cancelSync()">
          取消
        </button>
        <button v-if="banner.kind === 'stale' || banner.kind === 'recovered'" type="button" class="banner-button" @click="materials.startSync()">
          {{ banner.kind === 'recovered' ? '同步资料索引' : '更新索引' }}
        </button>
        <button v-if="banner.kind === 'failed' || banner.kind === 'partial'" type="button" class="banner-button" @click="materials.startSync()">
          重试
        </button>
        <button v-if="banner.kind !== 'progress'" type="button" class="banner-button" @click="materials.dismissBanner()">知道了</button>
      </span>
    </div>

    <form class="materials-search" role="search" @submit.prevent="submit">
      <AppIcon name="search" :size="17" />
      <input ref="input" v-model="state.draft" maxlength="100" :placeholder="'例如：计算机网络 期末试卷'"
             aria-label="输入课程或关键词" enterkeyhint="search" @keydown.esc="onEsc">
      <button v-if="state.draft" type="button" class="materials-clear" aria-label="清空" data-tip="清空" @click="materials.clearQuery()">
        <AppIcon name="close" :size="14" />
      </button>
      <button type="submit" class="primary-button" :disabled="!state.draft.trim()">搜索</button>
    </form>

    <p v-if="state.search.rewritten" class="materials-note materials-rewritten">
      已按「{{ state.search.rewritten }}」检索。
    </p>

    <div class="materials-body" aria-live="polite">
      <div v-if="view === 'loading'" class="materials-empty">
        <span class="spinner"></span>
        <p>正在读取资料索引…</p>
      </div>

      <section v-else-if="view === 'unsynced'" class="materials-empty page-card">
        <h2>先同步一次资料索引</h2>
        <p>第一次使用需要从三个公开来源读取资料目录（约 2 MB 的列表，不下载任何文件），之后搜索在本机完成，离线也能用。</p>
        <ul class="materials-sources-list">
          <li>GitHub · OpenISE（中大智能工程学院课程资料）</li>
          <li>GitHub · SYSU-Exam（中大历年期末试卷）</li>
          <li>arxiv.jaison.ink · 破壁计划（中大资料共享社区）</li>
        </ul>
        <button type="button" class="primary-button" @click="materials.startSync()">同步资料索引</button>
        <p class="materials-note">只读取公开的文件列表，不会上传你的文档、书名或搜索词。</p>
      </section>

      <section v-else-if="view === 'first-sync'" class="materials-empty page-card">
        <h2>正在同步资料索引</h2>
        <progress :value="state.sync.done" :max="Math.max(state.sync.total, 1)"></progress>
        <p class="materials-progress">{{ state.sync.message }}（{{ progressPercent }}%）</p>
        <button type="button" class="head-button" :disabled="!canCancel" @click="materials.cancelSync()">{{ cancelLabel }}</button>
      </section>

      <section v-else-if="view === 'first-sync-failed'" class="materials-empty page-card">
        <h2>同步没有完成</h2>
        <p class="page-warning" role="alert">{{ state.sync.error || state.statusError }}</p>
        <button type="button" class="primary-button" @click="materials.startSync()">重试</button>
        <p class="materials-note">如果 GitHub 打不开，可以稍后再试；破壁计划连得上时，大部分资料仍会同步下来。</p>
      </section>

      <section v-else-if="view === 'idle'" class="materials-idle">
        <h2>想找什么资料？</h2>
        <p class="materials-note">写课程名再加上资料类型，结果会更准。</p>
        <div class="materials-chips">
          <button v-for="example in EXAMPLES" :key="example" type="button" class="materials-chip" @click="runQuery(example)">
            {{ example }}
          </button>
        </div>
        <div v-if="state.prefs.recent.length" class="materials-recent">
          <p class="materials-recent-head">
            <span>最近搜索</span>
            <button type="button" class="link-button" @click="materials.forgetRecent()">清除</button>
          </p>
          <div class="materials-chips">
            <button v-for="item in state.prefs.recent" :key="item" type="button" class="materials-chip" @click="runQuery(item)">
              {{ item }}
            </button>
          </div>
        </div>
      </section>

      <div v-else-if="view === 'searching'" class="materials-empty">
        <span class="spinner"></span>
        <p>正在搜索…</p>
      </div>

      <section v-else-if="view === 'search-error'" class="materials-empty">
        <p class="page-warning" role="alert">搜索失败：{{ state.search.error }}</p>
        <button type="button" class="head-button" @click="materials.submit(state.search.submitted)">重试</button>
      </section>

      <section v-else-if="view === 'no-result'" class="materials-empty">
        <template v-if="result?.reason === 'empty-index'">
          <h2>还没有同步网络资料</h2>
          <p>文档库里也没有找到「{{ state.search.submitted }}」。同步一次资料索引后再搜一次吧。</p>
          <button type="button" class="primary-button" @click="materials.startSync()">同步资料索引</button>
        </template>
        <template v-else>
          <h2>没有找到足够相关的资料</h2>
          <p>「{{ state.search.submitted }}」在已同步的资料里没有可靠的匹配，所以不硬凑结果。可以试试：</p>
          <ul class="materials-sources-list">
            <li>只写课程名，例如「计算机网络」</li>
            <li>换个说法：「期末」「答案」「笔记」「课件」</li>
            <li>用全称代替简称，或反过来</li>
          </ul>
          <p v-if="hasHint('partial')" class="materials-note">上次同步时 GitHub 没有连上，索引可能不完整。</p>
          <button type="button" class="head-button" @click="materials.startSync()">更新索引</button>
        </template>
      </section>

      <template v-else-if="view === 'results'">
        <p v-if="hasHint('intent-only')" class="page-note materials-hint">
          只写了资料类型，结果会混合各门课；加上课程名会更准。
        </p>

        <section v-if="result && result.library.length" class="materials-group">
          <h2>文档库里已有<span>{{ result.library.length }}</span></h2>
          <ul class="materials-list">
            <li v-for="doc in result.library" :key="doc.docId" class="library-row">
              <div class="material-main">
                <span class="material-format">{{ doc.kind === 'pdf' ? 'PDF' : doc.kind === 'word' ? 'Word' : 'MD' }}</span>
                <span class="library-name">{{ doc.name }}</span>
              </div>
              <div class="material-actions">
                <button type="button" class="material-open" :disabled="doc.sourceMissing" @click="emit('open-document', doc.docId)">
                  <AppIcon name="file" :size="13" />{{ doc.sourceMissing ? '原文件已移动' : '打开' }}
                </button>
              </div>
            </li>
          </ul>
        </section>

        <section v-if="result && result.results.length" class="materials-group">
          <header class="materials-group-head">
            <h2>网络资料<span>{{ countLabel }}</span></h2>
            <div class="materials-rerank-row">
              <p class="materials-rerank" role="status">
                {{ rerankLine }}
                <button v-if="showSettingsHint" type="button" class="link-button" @click="emit('settings')">去设置</button>
              </p>
              <label class="materials-toggle">
                <input type="checkbox" role="switch" :checked="state.prefs.aiRerank"
                       @change="onToggleAi">
                <span data-tip="让模型先把查询改写成规范的课程名，再在结果里挑选并说明理由">AI 辅助</span>
              </label>
            </div>
          </header>
          <ol class="materials-list">
            <MaterialResultRow v-for="hit in materials.displayed.value" :key="hit.id" :hit="hit"
                               :reason="state.rerank.reasons[hit.id]" :prefer-mirror="state.prefs.preferMirror"
                               @open="openLink" @copy="copyLink" @open-document="id => emit('open-document', id)" />
          </ol>
        </section>
      </template>
    </div>

    <ConfirmDialog v-if="confirmClear" title="清空本地资料索引？" :message="clearMessage"
                   :confirm-label="confirmClear === 'resync' ? '清空并重新同步' : '清空索引'"
                   danger @confirm="doClear" @cancel="confirmClear = null" />
  </section>
</template>

<style scoped>
.materials-page { display: flex; flex-direction: column; gap: 14px; }
/* 宽屏下把内容收成一列居中，避免结果贴在最左侧、右边一大片空白 */
.materials-page > .materials-heading,
.materials-page > .materials-banner,
.materials-page > .materials-search,
.materials-page > .materials-body { width: 100%; max-width: 1040px; margin-inline: auto; }
.materials-heading { align-items: flex-start; gap: 10px; flex-wrap: wrap; }
.materials-head-info { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.materials-status { margin: 0; color: var(--muted); font-size: 12.5px; }
.materials-head-actions { display: flex; align-items: center; gap: 8px; }
.head-button {
  display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px;
  border: 1px solid var(--hairline); border-radius: var(--r-control);
  background: var(--frost, var(--fill-2)); color: var(--control-ink, var(--ink));
  font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer;
}
.head-button:hover { background: var(--frost-hover, var(--fill-3)); }
.head-button:disabled { opacity: .55; cursor: default; }
.head-button.icon-only { padding: 6px 9px; }
.materials-menu-wrap { position: relative; }
.materials-menu {
  position: absolute; right: 0; top: calc(100% + 6px); z-index: 30; min-width: 190px;
  display: flex; flex-direction: column; padding: 5px;
  border: 1px solid var(--hairline); border-radius: var(--r-control);
  background: var(--panel, var(--fill-1)); box-shadow: var(--shadow-2, 0 12px 30px rgba(0,0,0,.16));
}
.materials-menu button {
  padding: 7px 10px; border: 0; border-radius: var(--r-xs); background: none;
  color: var(--ink); font: inherit; font-size: 13px; text-align: left; cursor: pointer;
}
.materials-menu button:hover { background: var(--frost-hover, var(--fill-3)); }
.materials-menu button:disabled { opacity: .5; cursor: default; }
.materials-sources { padding: 6px 10px 8px; border-top: 1px solid var(--hairline); margin-top: 4px; }
.materials-sources p { margin: 3px 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
.materials-sources-note { margin-top: 7px !important; font-size: 11.5px !important; }
.materials-sources-empty { font-style: italic; }
.materials-banner {
  display: flex; align-items: center; gap: 10px; justify-content: space-between; flex-wrap: wrap;
  padding: 9px 13px; border-radius: var(--r-control); background: var(--fill-2);
}
.materials-banner.warn { border-left: 3px solid var(--warning, #b45309); }
.materials-banner.error { border-left: 3px solid var(--danger, #b91c1c); background: var(--danger-soft, #fef2f2); }
.materials-banner-text { font-size: 13px; line-height: 1.65; }
.materials-banner-actions { display: flex; gap: 7px; }
.banner-button {
  padding: 4px 10px; border: 1px solid var(--hairline); border-radius: var(--r-control);
  background: var(--frost, var(--fill-1)); color: var(--control-ink, var(--ink));
  font: inherit; font-size: 12px; cursor: pointer;
}
.banner-button:hover { background: var(--frost-hover, var(--fill-3)); }
.materials-search {
  display: flex; align-items: center; gap: 9px; width: 100%;
  padding: 8px 10px 8px 14px; border: 1px solid var(--hairline);
  border-radius: var(--r-control); background: var(--frost, var(--fill-2)); color: var(--muted);
}
.materials-search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring, transparent); }
.materials-search input {
  flex: 1; min-width: 0; border: 0; outline: none; background: none;
  color: var(--ink); font: inherit; font-size: 14px;
}
.materials-clear { display: inline-flex; border: 0; padding: 3px; border-radius: var(--r-xs); background: none; color: var(--muted); cursor: pointer; }
.materials-clear:hover { background: var(--fill-3); }
.materials-body { width: 100%; }
.materials-empty { display: flex; flex-direction: column; align-items: flex-start; gap: 9px; padding: 22px 0; color: var(--muted); }
.materials-empty.page-card { padding: 18px 20px; border-radius: var(--r-card, var(--r-control)); background: var(--fill-2); color: var(--ink); }
.materials-empty h2 { margin: 0; font-size: 15px; }
.materials-empty p { margin: 0; font-size: 13px; line-height: 1.75; }
.materials-empty .spinner { margin-right: 0; }
.materials-sources-list { margin: 0; padding-left: 18px; color: var(--muted); font-size: 12.5px; line-height: 1.9; }
.materials-note { color: var(--muted); font-size: 12px; }
.materials-rewritten { margin: -6px 0 0; }
.materials-progress { color: var(--muted); font-size: 12.5px; }
progress { width: 100%; height: 6px; accent-color: var(--accent); }
.materials-idle { display: flex; flex-direction: column; gap: 9px; padding: 18px 0; }
.materials-idle h2 { margin: 0; font-size: 15px; }
.materials-chips { display: flex; flex-wrap: wrap; gap: 7px; }
.materials-chip {
  padding: 5px 11px; border: 1px solid var(--hairline); border-radius: var(--r-full);
  background: var(--frost, var(--fill-2)); color: var(--control-ink, var(--ink));
  font: inherit; font-size: 12.5px; cursor: pointer;
}
.materials-chip:hover { background: var(--frost-hover, var(--fill-3)); }
.materials-recent { margin-top: 12px; display: flex; flex-direction: column; gap: 7px; }
.materials-recent-head { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 12.5px; }
.link-button { border: 0; padding: 0; background: none; color: var(--accent); font: inherit; font-size: 12.5px; cursor: pointer; }
.materials-hint { margin: 0 0 8px; }
.materials-group { margin-bottom: 18px; }
.materials-group h2 { display: flex; align-items: baseline; gap: 8px; margin: 0 0 8px; font-size: 14px; }
.materials-group h2 span { color: var(--muted); font-size: 12px; font-weight: 500; }
.materials-group-head { display: flex; flex-direction: column; gap: 4px; }
.materials-rerank-row { display: flex; align-items: center; gap: 12px; justify-content: space-between; flex-wrap: wrap; }
.materials-rerank { margin: 0; color: var(--muted); font-size: 12px; }
.materials-toggle { display: inline-flex; align-items: center; gap: 6px; color: var(--secondary); font-size: 12px; }
.materials-toggle input { accent-color: var(--accent); }
.materials-list { list-style: none; margin: 0; padding: 0; }
.library-row { padding: 11px 4px; border-bottom: 1px solid var(--hairline); }
.library-row:last-child { border-bottom: 0; }
.library-name { color: var(--ink); font-size: 13.5px; font-weight: 600; }
.material-main { display: flex; align-items: center; gap: 9px; }
.material-format {
  flex: none; padding: 1px 6px; border-radius: var(--r-xs);
  background: var(--fill-2); color: var(--secondary);
  font-family: var(--font-mono); font-size: 11px;
}
.material-actions { display: flex; gap: 7px; margin-top: 7px; flex-wrap: wrap; }
.material-open {
  display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px;
  border: 1px solid var(--accent); border-radius: var(--r-control);
  background: none; color: var(--accent); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
}
.material-open:disabled { border-color: var(--hairline); color: var(--muted); cursor: default; }
@media (max-width: 760px) {
  .materials-head-actions { width: 100%; }
  .materials-search { flex-wrap: wrap; }
  .materials-rerank-row { align-items: flex-start; }
}
@media (max-width: 520px) {
  .materials-heading h1 { font-size: 18px; }
  .materials-chips { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 4px; }
}
@media (prefers-reduced-motion: reduce) {
  .materials-page * { transition: none !important; animation: none !important; }
}
</style>
