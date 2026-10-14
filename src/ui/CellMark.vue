<script setup lang="ts">
// Drawn as lines rather than the "×" glyph: a font places the glyph on its
// baseline, so it never sits at the exact centre of a cell.
defineProps<{ error?: boolean }>();
</script>

<template>
  <svg
    class="cell-mark-glyph"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <path v-if="error" class="cell-mark-halo" d="M6 6 18 18M18 6 6 18" />
    <path d="M6 6 18 18M18 6 6 18" />
  </svg>
</template>
