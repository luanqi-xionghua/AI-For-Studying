<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { renderMarkdown, renderDiagrams } from '../../ai/render'

const props = withDefaults(defineProps<{
  content: string
  finished?: boolean
  dark?: boolean
  /** 外观：液态玻璃 / 暖色极简 / 铅笔草稿。避免用保留属性名 style。 */
  appearance?: 'glass' | 'warm' | 'sketch'
}>(), { finished: false, dark: false, appearance: 'glass' })
const emit = defineEmits<{ 'copy-failed': [] }>()
const host = ref<HTMLElement>()
let timer: ReturnType<typeof setTimeout> | undefined
let drawnKey = ''

function keyOf() { return `${props.content.length}:${props.content.slice(-24)}:${props.finished ? 1 : 0}:${props.dark ? 1 : 0}:${props.appearance}` }
function draw() {
  if (!host.value) return
  drawnKey = keyOf()
  host.value.innerHTML = renderMarkdown(props.content)
  if (props.finished) void renderDiagrams(host.value, Boolean(props.dark), props.appearance)
}
function schedule() {
  if (props.finished) {
    if (timer) { clearTimeout(timer); timer = undefined }
    draw()
    return
  }
  if (timer) return
  draw()
  timer = setTimeout(() => { timer = undefined; draw() }, 90)
}
watch(() => [props.content, props.finished, props.dark, props.appearance], () => { if (keyOf() !== drawnKey) schedule() })
onMounted(draw)
onBeforeUnmount(() => { if (timer) clearTimeout(timer) })

async function onClick(event: MouseEvent) {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-copy]')
  if (!button) return
  const code = button.closest('.answer-code-block')?.querySelector('code')?.textContent || ''
  try { await navigator.clipboard.writeText(code) } catch { emit('copy-failed'); return }
  button.classList.add('copied')
  button.setAttribute('aria-label', '已复制')
  button.dataset.tip = '已复制'
  setTimeout(() => {
    button.classList.remove('copied')
    button.setAttribute('aria-label', '复制代码')
    button.dataset.tip = '复制代码'
  }, 1400)
}
</script>

<template>
  <div ref="host" class="markdown-answer" @click="onClick" />
</template>

<style scoped>
.markdown-answer{font-size:14.5px;line-height:1.75;overflow-wrap:anywhere;font-family:var(--font-answer,var(--font-reading));letter-spacing:.005em}
.markdown-answer :deep(>:first-child){margin-top:0}
.markdown-answer :deep(>:last-child){margin-bottom:0}
.markdown-answer :deep(p){margin:0 0 .85em}
.markdown-answer :deep(h1),.markdown-answer :deep(h2),.markdown-answer :deep(h3),.markdown-answer :deep(h4){font-family:var(--font-answer,var(--font-reading));line-height:1.4;margin:1.1em 0 .5em}
.markdown-answer :deep(h1){font-size:1.3em}
.markdown-answer :deep(h2){font-size:1.18em}
.markdown-answer :deep(h3){font-size:1.06em}
.markdown-answer :deep(h4){font-size:1em}
.markdown-answer :deep(ul),.markdown-answer :deep(ol){margin:0 0 .85em;padding-left:1.4em}
.markdown-answer :deep(li){margin:.25em 0}
.markdown-answer :deep(li>p){margin:0}
.markdown-answer :deep(blockquote){margin:0 0 .85em;padding:.1em 0 .1em .9em;border-left:3px solid var(--hairline);color:var(--secondary)}
.markdown-answer :deep(hr){border:0;border-top:1px solid var(--hairline);margin:1.4em 0}
.markdown-answer :deep(a){color:var(--ink);text-decoration:underline;text-decoration-color:color-mix(in srgb,var(--ink) 35%,transparent)}
.markdown-answer :deep(strong){font-weight:650}
.markdown-answer :deep(code){font-family:var(--font-mono);font-size:.84em;padding:.12em .38em;border-radius:5px;background:color-mix(in srgb,var(--ink) 8%,transparent)}
.markdown-answer :deep(.answer-code-block){--ink:var(--surface-ink);margin:0 0 1em;border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden;background:var(--surface)}
.markdown-answer :deep(.answer-code-head){display:flex;align-items:center;justify-content:space-between;height:30px;padding:0 6px 0 12px;font-family:var(--font-mono);font-size:11px;color:var(--surface-muted);background:color-mix(in srgb,var(--surface-ink) 4%,transparent)}
.markdown-answer :deep(.answer-copy){display:grid;place-items:center;width:26px;height:24px;padding:0;border:0;border-radius:6px;background:none;box-shadow:none;color:var(--surface-muted);cursor:pointer}
.markdown-answer :deep(.answer-copy:hover){background:var(--frost-hover,color-mix(in srgb,var(--surface-ink) 8%,transparent));color:var(--surface-ink)}
.markdown-answer :deep(pre.answer-code){margin:0;padding:10px 12px;overflow:auto;font-size:12px;line-height:1.6}
.markdown-answer :deep(pre.answer-code code){padding:0;border:0;background:none;font-size:inherit}
.markdown-answer :deep(.answer-table){overflow:auto;margin:.2em 0 1em;border:1px solid var(--hairline);border-radius:var(--r-md)}
.markdown-answer :deep(table){border-collapse:collapse;min-width:100%;font-family:var(--font-reading);font-size:13.5px;font-variant-numeric:tabular-nums}
.markdown-answer :deep(th),.markdown-answer :deep(td){padding:9px 14px;border-bottom:1px solid var(--hairline);text-align:left;vertical-align:top}
.markdown-answer :deep(th){background:color-mix(in srgb,var(--ink) 5%,transparent);font-weight:500;color:var(--secondary)}
.markdown-answer :deep(tr:last-child td){border-bottom:0}
.markdown-answer :deep(.answer-diagram){margin:0 0 1em;padding:12px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--surface);color:var(--surface-ink);overflow:auto}
.markdown-answer :deep(.answer-diagram.rendered svg){max-width:100%;height:auto}
.markdown-answer :deep(.markdown-math){overflow-x:auto;overflow-y:hidden;margin:0 0 .85em}
.markdown-answer :deep(.katex){font-size:1.06em}
</style>
