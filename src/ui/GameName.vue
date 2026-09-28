<script setup lang="ts">
import { computed } from "vue";
import { gameNameParts } from "../core/account-profile";
const props = defineProps<{ name: string }>();
const parts = computed(() => gameNameParts(props.name));
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
