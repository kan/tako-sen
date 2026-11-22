<script setup lang="ts">
import { computed } from "vue";
import { nameParts } from "kan-game/name-rules";
const props = defineProps<{ name: string }>();
const parts = computed(() => nameParts(props.name));
</script>

<template>
  <span class="game-name"
    ><span
      v-for="(part, index) in parts"
      :key="index"
      :class="{ 'name-emoji': part.emoji }"
      >{{ part.text }}</span
    ></span
  >
</template>
