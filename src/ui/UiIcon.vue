<script setup lang="ts">
defineProps<{
  name:
    | "settings"
    | "mistake"
    | "hint"
    | "clock"
    | "difficulty"
    | "reset"
    | "next"
    | "daily"
    | "super"
    | "ranking";
}>();
</script>

<template>
  <svg
    class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <template v-if="name === 'daily'">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4M17 3v4M3 10h18m-13 5 3 3 5-5" />
    </template>
    <template v-else-if="name === 'super'">
      <path d="m3 7 4 3 5-6 5 6 4-3-2 12H5ZM5 22h14" />
    </template>
    <template v-else-if="name === 'settings'">
      <path
        d="m9 3-.7 2.5-1.7 1L4 6l-2 3.5 1.9 1.8v1.9L2 15l2 3.5 2.6-.5 1.7 1L9 21h6l.7-2.5 1.7-1 2.6.5 2-3.5-1.9-1.8v-1.9L22 9l-2-3.5-2.6.5-1.7-1L15 3Z"
      />
      <circle cx="12" cy="12" r="3" />
    </template>
    <path v-else-if="name === 'mistake'" d="m6 6 12 12M18 6 6 18" />
    <template v-else-if="name === 'hint'">
      <path d="M9 17c0-3-4-4-4-8a7 7 0 0 1 14 0c0 4-4 5-4 8ZM9 20h6M10 23h4" />
      <path d="M12 17v-5m-2-2 2 2 2-2" />
    </template>
    <template v-else-if="name === 'clock'">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" />
    </template>
    <template v-else-if="name === 'difficulty'">
      <path d="M4 20v-5h3v5ZM10 20V9h3v11ZM16 20V3h3v17Z" />
    </template>
    <path v-else-if="name === 'reset'" d="M4 11a8 8 0 1 1 2 7M4 4v7h7" />
    <path v-else-if="name === 'next'" d="m3 5 8 7-8 7Zm9 0 8 7-8 7ZM21 5v14" />
    <template v-else-if="name === 'ranking'">
      <path d="M3 20h18M4 20v-5h5v5M9 20V8h6v12M15 20v-7h5v7" />
      <path
        d="m12 3 .5 1.2L14 4.5l-1 1 .2 1.5L12 6.3l-1.2.7L11 5.5l-1-1 1.5-.3Z"
      />
    </template>
  </svg>
</template>
