<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '../ui/AppIcon.vue'
import type { MaterialHit, MaterialLink } from '../../materials/types.ts'

const props = defineProps<{ hit: MaterialHit; reason?: string; preferMirror: boolean }>()
const emit = defineEmits<{
  open: [link: MaterialLink]
  copy: [url: string]
  'open-document': [id: string]
}>()

const primary = computed<MaterialLink>(() => {
  const links = props.hit.links
  if (props.preferMirror) {
    const mirror = links.find(link => link.host === 'arxiv.jaison.ink')
    if (mirror) return mirror
  }
  return links[0]
})

const others = computed(() => props.hit.links
  .filter(link => link.id !== primary.value.id)
  .slice(0, 3))

const openLabel = computed(() => (primary.value.host === 'github.com'
  ? '在 GitHub 打开'
  : '在破壁计划打开'))

const sizeText = computed(() => {
  const size = props.hit.size || 0
  if (!size) return ''
  return size > 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.round(size / 1024)} KB`
})

const categoryText = computed(() => {
  const text = props.hit.category || ''
  return text.length > 30 ? `${text.slice(0, 30)}…` : text
})

const metaLine = computed(() => [
  props.hit.course,
  categoryText.value,
  sizeText.value,
  props.hit.year ? String(props.hit.year) : '',
  `来源：${primary.value.label}`,
].filter(Boolean).join(' · '))

const ownedTip = computed(() => (props.hit.owned
  ? `文档库里有${props.hit.owned.match === 'name' ? '同名' : '同样大小'}的文件：${props.hit.owned.name}`
  : ''))
</script>

<template>
  <li class="material-row">
    <div class="material-main">
      <span class="material-format" :data-ext="hit.ext">{{ hit.format }}{{ hit.count > 1 ? ` ×${hit.count}` : '' }}</span>
      <button type="button" class="material-title" :data-tip="hit.title" @click="emit('open', primary)">
        {{ hit.title }}
      </button>
      <span v-if="hit.owned" class="material-badge" :data-tip="ownedTip">你已有</span>
    </div>

    <p class="material-meta">{{ metaLine }}</p>
    <p v-if="reason" class="material-reason">
      <AppIcon name="sparkle" :size="12" />{{ reason }}
    </p>

    <div class="material-actions">
      <button type="button" class="material-open" :aria-label="`${openLabel}：${hit.title}`" @click="emit('open', primary)">
        <AppIcon name="external" :size="13" />{{ openLabel }}
      </button>
      <button v-for="link in others" :key="link.id" type="button" class="material-mirror" @click="emit('open', link)">
        {{ link.label }} 镜像
      </button>
      <button type="button" class="icon-button" aria-label="复制链接" data-tip="复制链接" @click="emit('copy', hit.url)">
        <AppIcon name="copy" :size="13" />
      </button>
      <button v-if="hit.owned" type="button" class="material-mirror" @click="emit('open-document', hit.owned.docId)">
        在文档库打开
      </button>
    </div>
  </li>
</template>

<style scoped>
.material-row { padding: 12px 4px 13px; border-bottom: 1px solid var(--hairline); }
.material-row:last-child { border-bottom: 0; }
.material-row:hover { background: var(--frost-hover, var(--fill-3)); }
.material-main { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.material-format {
  flex: none; padding: 1px 6px; border-radius: var(--r-xs);
  background: var(--fill-2); color: var(--secondary);
  font-family: var(--font-mono); font-size: 11px; letter-spacing: .02em;
}
.material-title {
  border: 0; padding: 0; background: none; cursor: pointer;
  color: var(--ink); font: inherit; font-weight: 600; text-align: left; line-height: 1.5;
}
.material-title:hover { color: var(--accent); }
.material-badge {
  flex: none; padding: 1px 8px; border-radius: var(--r-full);
  background: var(--accent-soft); color: var(--accent); font-size: 11px; font-weight: 600;
}
.material-meta { margin: 5px 0 0; color: var(--muted); font-size: 12px; line-height: 1.7; }
.material-reason {
  display: flex; align-items: center; gap: 5px;
  margin: 6px 0 0; color: var(--secondary); font-size: 12.5px;
}
.material-reason svg { color: var(--accent); }
.material-actions { display: flex; align-items: center; gap: 7px; margin-top: 9px; flex-wrap: wrap; }
.material-open, .material-mirror {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; border: 1px solid var(--hairline); border-radius: var(--r-control);
  background: var(--frost, var(--fill-2)); color: var(--control-ink, var(--ink));
  font: inherit; font-size: 12px; cursor: pointer;
}
.material-open:hover, .material-mirror:hover { background: var(--frost-hover, var(--fill-3)); }
.material-open { border-color: var(--accent); color: var(--accent); font-weight: 600; }
.material-mirror { color: var(--secondary); }
</style>
