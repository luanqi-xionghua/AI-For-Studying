<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
}>(), { cancelLabel: '取消', danger: false })
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const cancelButton = ref<HTMLButtonElement>()
const confirmButton = ref<HTMLButtonElement>()
let previous: HTMLElement | null = null

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('cancel') }
  else if (event.key === 'Tab') {
    event.preventDefault()
    const next = document.activeElement === cancelButton.value ? confirmButton.value : cancelButton.value
    next?.focus()
  }
}
onMounted(() => {
  previous = document.activeElement as HTMLElement | null
  cancelButton.value?.focus()
  document.addEventListener('keydown', onKeydown, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, true)
  previous?.focus?.()
})
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('cancel')">
    <section class="confirm-dialog" role="alertdialog" aria-modal="true" :aria-label="props.title">
      <h2>{{ props.title }}</h2>
      <p>{{ props.message }}</p>
      <div class="dialog-actions">
        <button ref="cancelButton" type="button" @click="emit('cancel')">{{ props.cancelLabel }}</button>
        <button ref="confirmButton" type="button" :class="{ 'danger-button': props.danger }" @click="emit('confirm')">{{ props.confirmLabel }}</button>
      </div>
    </section>
  </div>
</template>
