<template>
  <header class="page-heading">
    <div class="heading-copy">
      <div class="heading-eyebrow">{{ eyebrow }}</div>
      <h1>{{ title }}</h1>
      <p>{{ description }}</p>
    </div>
    <div v-if="$slots.default" class="heading-actions"><slot /></div>
  </header>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  eyebrow: { type: String, default: '工作空间' }
})
</script>

<style scoped>
.page-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
.heading-copy { min-width: 0; }
.heading-eyebrow { margin-bottom: 10px; font-size: 11px; font-weight: 600; letter-spacing: 2px; color: var(--app-muted); }
h1 { font-size: clamp(23px, 2vw, 29px); font-weight: 650; line-height: 1.3; letter-spacing: -.7px; color: var(--app-text); }
p { margin-top: 10px; font-size: 13px; line-height: 1.7; color: var(--app-muted); }
.heading-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
@media (max-width: 767px) { .page-heading { gap: 16px; } .heading-eyebrow { margin-bottom: 7px; } }
</style>
