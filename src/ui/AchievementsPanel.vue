<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  isAchievementHidden,
  type AchievementDefinition,
} from "../core/achievements";
import { apiFetch, useId } from "./auth";
import {
  achievementIcon,
  lastSeenUnlock,
  markUnlocksSeen,
  parseAchievementList,
  type AchievementStatus,
} from "./achievements";
import { trapDialogFocus } from "./dialog";

/**
 * 実績の一覧（メニューの「実績」）。アイコンのタイルを並べ、未解除はシルエットで
 * 出す。タイルを押すと詳細を重ねて出す。ID がないかオフラインなら、一覧の代わりに
 * オンラインで表示する旨だけを出す（履歴・成績のデイリーと同じく、端末に残さない）。
 */

const { id } = useId();
const online = ref(navigator.onLine !== false);
const list = ref<AchievementStatus[]>();
const failed = ref(false);
/** 開いた時点で「NEW」とする基準（開いたら既読にするので、開く前の値を使う） */
const seenBefore = ref(0);
let generation = 0;

interface Tile {
  readonly definition: AchievementDefinition;
  readonly unlocked: boolean;
  readonly isNew: boolean;
  readonly name: string;
  readonly description: string;
  readonly status: string;
  readonly icon: string;
  readonly label: string;
}

// 解除した日は、デイリーの日付と同じく日本時間で出す。
const dateLabel = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "long",
  day: "numeric",
});

const tiles = computed<Tile[]>(() =>
  (list.value ?? []).map(({ definition, unlockedAt, progress }) => {
    const unlocked = unlockedAt !== null;
    const hidden = isAchievementHidden(definition, unlocked);
    const isNew = (unlockedAt ?? 0) > seenBefore.value;
    const name = hidden ? "秘密の実績" : definition.name;
    return {
      definition,
      unlocked,
      isNew,
      name,
      description: hidden
        ? "条件を満たすと解除されます。"
        : definition.description,
      // 進み具合を出すかはサーバーが決める（出さないものは progress が null）。
      // 秘密の実績は、しきい値で条件が分かるので、値が届いても出さない。
      status: unlocked
        ? `${dateLabel.format(unlockedAt)}に解除`
        : hidden || progress === null || !("threshold" in definition)
          ? "未解除"
          : `未解除（${progress} / ${definition.threshold}）`,
      icon: achievementIcon(hidden ? "secret" : definition.id),
      label: `${name}、${unlocked ? "解除済み" : "未解除"}${isNew ? "、新しく解除" : ""}`,
    };
  }),
);
const unlockedCount = computed(
  () => tiles.value.filter((tile) => tile.unlocked).length,
);

async function load(): Promise<void> {
  const account = id.value;
  const current = ++generation;
  list.value = undefined;
  failed.value = false;
  if (!account || !online.value) return;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30000);
  try {
    const response = await apiFetch("/api/achievements", {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Achievements unavailable.");
    const parsed = parseAchievementList(await response.json());
    if (!parsed) throw new Error("Unexpected achievements.");
    // ID か接続が変われば load() が呼び直され、generation が進む。
    if (current !== generation) return;
    seenBefore.value = lastSeenUnlock(account);
    list.value = parsed;
    markUnlocksSeen(account, parsed);
  } catch {
    if (current === generation) failed.value = true;
  } finally {
    window.clearTimeout(timeout);
  }
}

function onConnection(): void {
  online.value = navigator.onLine !== false;
}
onMounted(() => {
  window.addEventListener("online", onConnection);
  window.addEventListener("offline", onConnection);
  void load();
});
onUnmounted(() => {
  generation += 1;
  window.removeEventListener("online", onConnection);
  window.removeEventListener("offline", onConnection);
});
watch([id, online], () => {
  selected.value = undefined;
  void load();
});

// 詳細のダイアログ。一覧のダイアログの上に重ね、閉じたら押したタイルへ戻る。
// 押したタイルは currentTarget で覚える（Safari はボタンを押してもフォーカスを移さない）。
const selected = ref<Tile>();
const detail = ref<HTMLElement>();
let opener: HTMLElement | null = null;

async function openDetail(tile: Tile, event: MouseEvent): Promise<void> {
  opener = event.currentTarget as HTMLElement;
  selected.value = tile;
  await nextTick();
  detail.value?.focus();
}
function closeDetail(): void {
  selected.value = undefined;
  if (opener?.isConnected) opener.focus();
  opener = null;
}
function onDetailKeydown(event: KeyboardEvent): void {
  // 一覧のダイアログの Escape と Tab の扱いまで届かせない。
  event.stopPropagation();
  if (event.key === "Escape") {
    event.preventDefault();
    closeDetail();
  } else trapDialogFocus(event, detail.value);
}
</script>

<template>
  <div class="achievements-panel">
    <p v-if="!id || !online">実績はオンラインで表示します。</p>
    <p v-else-if="failed" role="status">
      実績を取得できません。少し待ってから開き直してください。
    </p>
    <p v-else-if="!list" role="status">実績を読み込んでいます…</p>
    <template v-else>
      <p class="achievements-count">
        解除 <strong>{{ unlockedCount }}</strong> / {{ tiles.length }}
      </p>
      <ul class="achievement-tiles">
        <li v-for="tile in tiles" :key="tile.definition.id">
          <button
            type="button"
            class="achievement-tile"
            :class="{ 'is-locked': !tile.unlocked, 'is-new': tile.isNew }"
            :aria-label="tile.label"
            aria-haspopup="dialog"
            @click="openDetail(tile, $event)"
          >
            <img :src="tile.icon" alt="" draggable="false" />
            <span v-if="tile.isNew" class="achievement-new" aria-hidden="true"
              >NEW</span
            >
          </button>
        </li>
      </ul>
    </template>
  </div>

  <Teleport to="body">
    <div
      v-if="selected"
      class="dialog-backdrop achievement-detail-backdrop"
      role="presentation"
      @click.self="closeDetail"
    >
      <section
        ref="detail"
        class="dialog-card achievement-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="achievement-detail-title"
        aria-describedby="achievement-detail-description"
        tabindex="-1"
        @keydown="onDetailKeydown"
      >
        <div class="dialog-header">
          <h2 id="achievement-detail-title">{{ selected.name }}</h2>
          <button
            type="button"
            class="dialog-close"
            :aria-label="`${selected.name}を閉じる`"
            @click="closeDetail"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <img
          class="achievement-detail-icon"
          :class="{ 'is-locked': !selected.unlocked }"
          :src="selected.icon"
          alt=""
          draggable="false"
        />
        <p id="achievement-detail-description">{{ selected.description }}</p>
        <p class="achievement-detail-status">{{ selected.status }}</p>
      </section>
    </div>
  </Teleport>
</template>
