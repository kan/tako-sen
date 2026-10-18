<script setup lang="ts">
import { computed, onMounted } from "vue";
import {
  disablePush,
  enablePush,
  pushBusy,
  pushProblem,
  pushState,
  refreshPushState,
} from "./push";
import { PRESS_AGAIN_ONLINE } from "./notice-text";

/** The daily notice in the settings dialog (src/ui/push.ts). */
onMounted(() => void refreshPushState());

const usable = computed(
  () => pushState.value === "on" || pushState.value === "off",
);

const help = computed(() => {
  switch (pushState.value) {
    case "checking":
      return "通知の設定を確かめています。";
    case "install":
      return "iPhone と iPad では、Safari の共有メニューから「ホーム画面に追加」し、追加した TAKO-SEN から開くと通知を受け取れます。";
    case "unsupported":
      return "このブラウザでは通知を受け取れません。";
    case "unavailable":
      return "いまは通知を設定できません。";
    case "denied":
      return "この端末かブラウザの設定で、TAKO-SEN の通知が許可されていません。許可すると、ここでオンにできます。";
    default:
      return "毎日 0:05 ごろ、その日のデイリーチャレンジが始まったことを知らせます。この端末だけの設定です。";
  }
});

// v-model sets the box from the state on every render, including the one
// pushBusy causes, so a refused or failed switch shows as off again.
const enabled = computed({
  get: () => pushState.value === "on",
  set: (wanted: boolean) => void (wanted ? enablePush() : disablePush()),
});
</script>

<template>
  <div class="daily-notice-settings">
    <label class="settings-toggle">
      <input
        v-model="enabled"
        type="checkbox"
        :disabled="!usable || pushBusy"
        aria-describedby="daily-notice-help"
      />
      デイリーチャレンジの開始を通知する
    </label>
    <p id="daily-notice-help">{{ help }}</p>
    <p v-if="pushProblem" role="status">
      {{
        pushProblem === "offline"
          ? PRESS_AGAIN_ONLINE
          : pushProblem === "too_many"
            ? "この ID で通知をオンにしている端末が多すぎます。使っていない端末で通知をオフにしてから、もう一度切り替えてください。"
            : "通知を設定できませんでした。少し待ってから、もう一度切り替えてください。"
      }}
    </p>
  </div>
</template>
