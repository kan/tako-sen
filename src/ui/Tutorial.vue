<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { Show, SignInButton } from "@clerk/vue";
import TutorialBoard from "./TutorialBoard.vue";
import { trapDialogFocus } from "./dialog";

const props = defineProps<{ open: boolean; onlineEnabled: boolean }>();
const emit = defineEmits<{ close: [] }>();
const step = ref(0);
const dialog = ref<HTMLElement>();
const titles = [
  "タコを8匹置こう",
  "タップと長押し",
  "ミスとヒント",
  "基本の定石",
  "ランキングに参加",
];
watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    step.value = 0;
    await nextTick();
    dialog.value?.focus();
  },
  { immediate: true },
);
async function moveStep(delta: number): Promise<void> {
  step.value += delta;
  await nextTick();
  if (dialog.value) dialog.value.scrollTop = 0;
  dialog.value?.focus();
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  } else trapDialogFocus(event, dialog.value);
}
</script>

<template>
  <div
    v-if="open"
    class="dialog-backdrop"
    @click.self="emit('close')"
    @keydown="onKeydown"
  >
    <section
      ref="dialog"
      class="dialog-card tutorial-card"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-title"
      aria-describedby="tutorial-progress"
    >
      <div class="dialog-header">
        <h2 id="tutorial-title">{{ titles[step] }}</h2>
        <button
          type="button"
          class="dialog-close"
          aria-label="遊び方を閉じる"
          @click="emit('close')"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <p id="tutorial-progress">遊び方 {{ step + 1 }} / {{ titles.length }}</p>
      <div class="tutorial-content">
        <template v-if="step === 0">
          <p>8×8の盤面に、タコを全部で8匹置くパズルです。</p>
          <ul>
            <li>各行に1匹、各列に1匹。</li>
            <li>太い線で囲まれた各エリアにも1匹。</li>
            <li>タコ同士は縦・横・斜めに隣り合えません。</li>
          </ul>
          <TutorialBoard
            kind="rules"
            :after="true"
            label="8×8盤面の一部：異なる行・列・エリアにタコを2匹置いた例。各タコと同じ行・列・エリア、隣接するマスには×。○はこの2匹からは除外できない候補です。"
          />
          <p>
            離れた斜めのマスは候補に残ります。○は正解を保証する印ではありません。
          </p>
          <p>
            この条件から、タコが入る場所を絞り込みましょう。ログインせずに遊べます。
          </p>
        </template>
        <template v-else-if="step === 1">
          <ul>
            <li>
              <strong>タップ / クリック：</strong
              >「ここには置かない」という×を付ける・外す。
            </li>
            <li>
              <strong>ドラッグ：</strong
              >空きマスからなら通ったマスに×を追加し、×のマスからなら×を除去。
            </li>
            <li>
              <strong>長押し：</strong
              >押すと細い枠と進捗が出ます。太い枠になったら指やマウスを離してタコを確定。強調後もスライドすると×のドラッグ入力へ切り替わります。
            </li>
          </ul>
          <p>
            ×のあるマスにはタコを置けません。先にタップして×を外してください。
          </p>
          <p>
            タコも×も入力せずキャンセルするには、ドラッグを始める前に盤面の外へ指やマウスを動かしてください。すでにドラッグで変更した×は残ります。
          </p>
        </template>
        <template v-else-if="step === 2">
          <p>
            正しく置けたタコは固定されます。間違った場所に置くと、消せない赤い×になり、ミスが1増えます。
          </p>
          <p>普段の×入力では正誤判定しません。間違った×は自分で外せます。</p>
          <p>
            困ったら「ヒント」で注目箇所から順に確認できます。ヒントは学ぶための機能なので、気軽に使ってください。
          </p>
        </template>
        <template v-else-if="step === 3">
          <p>
            <strong>タコから消す：</strong
            >タコを置いたら、その行・列・エリア・周囲8マスには別のタコを置けません。置いたタコをダブルタップ
            / ダブルクリックすると、×をまとめて付けられます。
          </p>
          <div class="tutorial-board-pair">
            <TutorialBoard
              kind="piece"
              :after="false"
              label="操作前：タコを置いたところ。"
            />
            <TutorialBoard
              kind="piece"
              :after="true"
              label="操作後：タコをダブルタップすると、枠付きの×が付きます。"
            />
          </div>
          <p>
            <strong>ライン消し：</strong
            >あるエリアの候補が1行だけに残ったら、そのエリアのタコは必ずその行に入ります。同じ行の別エリアには×を付けられます。1列だけの場合も同じです。
          </p>
          <div class="tutorial-board-pair">
            <TutorialBoard
              kind="line"
              :after="false"
              label="操作前：青いエリアの候補○は2行目だけ。タコは○のどちらかに入ります。"
            />
            <TutorialBoard
              kind="line"
              :after="true"
              label="操作後：2行目の別エリアに、枠付きの×を追加できます。○はそのままです。"
            />
          </div>
          <p>図は8×8盤面の一部です。枠付きの×はこの操作で新しく付く印です。</p>
          <p>
            候補が絞れたエリアの未確定マスをダブルタップ /
            ダブルクリックすると、この×をまとめて付けられます。タコの場所までは自動で決めません。
          </p>
        </template>
        <template v-else>
          <p>
            ログインしてゲーム名を設定し、公開ルールに同意すると、その後のクリア履歴が自動同期されます。
          </p>
          <p>
            問題ごとにサーバーへ最初に登録されたクリアが、ゲーム名付きでランキングに載ります。再挑戦は個人履歴に残ります。
          </p>
          <p>
            同意前・未ログイン時の過去のクリアは取り込みません。個別の非公開設定はなく、退会すると公開記録を削除します。名前の変更は現在できません。
          </p>
          <div v-if="onlineEnabled" class="dialog-actions">
            <Show when="signed-out"
              ><SignInButton
                ><button type="button" @click="emit('close')">
                  ログインして参加
                </button></SignInButton
              ></Show
            >
          </div>
          <p v-else>
            この環境ではオンライン機能は無効です。オフラインでそのまま遊べます。
          </p>
        </template>
      </div>
      <p v-if="step === titles.length - 1">
        後から「遊び方」でいつでも読み直せます。
      </p>
      <div class="dialog-actions">
        <button v-if="step > 0" type="button" @click="moveStep(-1)">
          戻る
        </button>
        <button
          v-if="step < titles.length - 1"
          type="button"
          @click="moveStep(1)"
        >
          次へ
        </button>
        <button type="button" @click="emit('close')">
          {{ step === titles.length - 1 ? "遊ぶ" : "スキップ" }}
        </button>
      </div>
    </section>
  </div>
</template>
