<script setup lang="ts">
import { computed } from "vue";
import { tutorialDiagramCells } from "./tutorial-diagrams";

const props = defineProps<{
  kind: "rules" | "piece" | "line";
  after: boolean;
  label: string;
}>();
const cells = computed(() => tutorialDiagramCells(props.kind, props.after));
const colors = ["#ffdfa3", "#bde4f2", "#decaf4"];
</script>

<template>
  <figure class="tutorial-board">
    <svg viewBox="-2 -2 244 164" role="img" :aria-label="label">
      <g v-for="cell in cells" :key="cell.index">
        <rect
          :x="cell.col * 40"
          :y="cell.row * 40"
          width="40"
          height="40"
          :fill="colors[cell.region]"
          stroke="#8b8173"
          stroke-width="1"
        />
        <rect
          v-if="cell.added"
          :x="cell.col * 40 + 5"
          :y="cell.row * 40 + 5"
          width="30"
          height="30"
          rx="5"
          fill="none"
          stroke="#8b3023"
          stroke-width="2"
        />
        <text
          v-if="cell.mark !== 'empty'"
          :x="cell.col * 40 + 20"
          :y="cell.row * 40 + 27"
          text-anchor="middle"
          :class="[
            'tutorial-symbol',
            {
              'tutorial-added': cell.added,
              'tutorial-octopus': cell.mark === 'piece',
            },
          ]"
        >
          {{
            cell.mark === "piece" ? "🐙" : cell.mark === "excluded" ? "×" : "○"
          }}
        </text>
        <path
          v-if="cell.borderRight"
          :d="`M${(cell.col + 1) * 40},${cell.row * 40}v40`"
          stroke="#2a1b14"
          stroke-width="3"
        />
        <path
          v-if="cell.borderBottom"
          :d="`M${cell.col * 40},${(cell.row + 1) * 40}h40`"
          stroke="#2a1b14"
          stroke-width="3"
        />
      </g>
      <path d="M0,160V0H240" fill="none" stroke="#2a1b14" stroke-width="3" />
    </svg>
    <figcaption>{{ label }}</figcaption>
  </figure>
</template>

<style scoped>
.tutorial-board {
  margin: 12px 0;
}
svg {
  display: block;
  width: 100%;
  max-width: 300px;
  height: auto;
  margin: 0 auto;
}
figcaption {
  margin-top: 6px;
  font-size: 13px;
  line-height: 1.5;
}
.tutorial-symbol {
  font-size: 27px;
  fill: #34434c;
}
.tutorial-added {
  fill: #8b3023;
  font-weight: 800;
}
.tutorial-octopus {
  font-family:
    "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
  font-variant-emoji: emoji;
}
</style>
