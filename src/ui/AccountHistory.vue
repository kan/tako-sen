<script setup lang="ts">
import {
  apiFetch,
  issueTransferCode,
  portalUrl,
  redeemTransferCode,
  refreshId,
  useId,
} from "./auth";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from "vue";
import GameName from "./GameName.vue";
import { trapDialogFocus } from "./dialog";
import {
  ID_STORAGE_NOTE,
  PLAY_CONTINUES,
  PRESS_AGAIN_ONLINE,
} from "./notice-text";
import { createCompletedPlayUpload } from "../core/online-history";
import {
  GAME_NAME_MAX,
  GAME_NAME_MIN,
  RANKING_CONSENT_VERSION,
  gameNameParts,
  gameNameProblem,
  validateGameName,
  loadCachedProfile,
  saveCachedProfile,
  type AccountProfile,
} from "../core/account-profile";
import { SyncOutbox } from "../core/sync-outbox";
import type { SyncedRanking } from "../core/leaderboard";
import type { PlayResult } from "../core/results";
import { askConfirm } from "./confirm-dialog";

const props = defineProps<{
  plays: readonly PlayResult[];
  open: boolean;
}>();
const emit = defineEmits<{
  /** 送信に成功した。最後に送った記録の問題のランキングが応答にあれば添える。 */
  synced: [ranking?: SyncedRanking];
  /** 記録の送信中かどうか。送信中は、送信後に届くランキングを待てる。 */
  sending: [active: boolean];
  profile: [name: string];
  close: [];
}>();
const dialogRef = ref<HTMLElement>();
const nameInputRef = ref<HTMLInputElement>();
const { id, name: platformName, status } = useId();
const cacheStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
} satisfies import("../core/storage").KeyValueStorage;
const outbox = new SyncOutbox(props.plays, cacheStorage);
const profile = ref<AccountProfile | null>(null);
/**
 * A name the ID already has from another kan-game.app game (the ID platform
 * sends it with the ID): consent is then all TAKO-SEN asks for.
 */
const sharedName = computed(() => (profile.value ? null : platformName.value));
const profileLoading = ref(false);
const gameName = ref("");
const consent = ref(false);
const busy = ref(false);
const syncing = ref(false);
const message = ref("");
const syncMessage = ref("");
const pendingCount = ref(0);
const transferCode = ref<{ code: string; expiresAt: number } | null>(null);
const enteredCode = ref("");
let epoch = 0;
let disposed = false;
let retryTimer: ReturnType<typeof setInterval> | undefined;

const accountUrl = portalUrl("/account");
const privacyUrl = portalUrl("/privacy");

/** What is wrong with the typed name, once there is something typed. */
const nameProblem = computed(() => {
  const name = gameName.value.normalize("NFC").trim();
  const problem = name ? gameNameProblem(name) : undefined;
  return problem === "length"
    ? `プレイヤー名は${GAME_NAME_MIN}〜${GAME_NAME_MAX}文字にしてください（いま${gameNameParts(name).length}文字）。`
    : problem === "chars"
      ? "使えない文字が入っています。「・」や「！」などの記号は使えません。"
      : "";
});
/** Why the submit button does nothing yet, said beside it. */
const submitHint = computed(() =>
  !sharedName.value && !gameName.value.trim()
    ? "プレイヤー名を入力してください。"
    : !sharedName.value && nameProblem.value
      ? "プレイヤー名を直してください。"
      : !consent.value
        ? "公開ルールに同意すると設定できます。"
        : "",
);
const transferExpiry = computed(() =>
  transferCode.value
    ? new Date(transferCode.value.expiresAt).toLocaleTimeString("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "",
);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    // The name field, when this ID still has to choose a name; otherwise the
    // dialog itself (also before the device has an ID, when there is no form).
    (nameInputRef.value ?? dialogRef.value)?.focus();
    // A name chosen in another game since the page opened comes with the ID.
    void refreshId();
    void loadProfile();
  },
);

function onAccountKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
    return;
  }
  trapDialogFocus(event, dialogRef.value);
}

// A new ID (a transfer code, or a withdrawal elsewhere) starts this screen over.
// The previous ID's unsent clears can no longer be sent (the cookie now holds
// the new ID), so they are dropped; this device's own history keeps them.
watch(
  id,
  (_, previous) => {
    if (previous) outbox.forget(previous);
    epoch += 1;
    profileLoading.value = false;
    profile.value = id.value ? loadCachedProfile(id.value, cacheStorage) : null;
    gameName.value = "";
    consent.value = false;
    message.value = "";
    syncMessage.value = "";
    transferCode.value = null;
    emit("profile", profile.value?.displayName ?? "");
    void loadProfile();
  },
  { immediate: true },
);

// Every clear goes to the ID's history, named or not (the server ranks only
// those after consent). Before this device has an ID none is kept.
watch(
  () => props.plays,
  (plays) => {
    outbox.capture(plays, id.value);
    void synchronize();
  },
  { flush: "sync" },
);

async function accountFetch(
  accountId: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  if (disposed || id.value !== accountId) throw new Error("Account changed.");
  return apiFetch(path, init);
}

async function loadProfile(): Promise<void> {
  const accountId = id.value;
  if (!accountId || profileLoading.value) return;
  const current = epoch;
  profileLoading.value = true;
  try {
    const response = await accountFetch(accountId, "/api/profile");
    if (!response.ok) throw new Error("Profile unavailable.");
    const data: { profile: AccountProfile | null } = await response.json();
    if (current !== epoch || disposed) return;
    profile.value = data.profile;
    saveCachedProfile(accountId, data.profile, cacheStorage);
    emit("profile", data.profile?.displayName ?? "");
  } catch {
    if (current !== epoch || disposed) return;
    message.value = `オンライン設定を確認できません。接続を確認して、アカウントを開き直してください。${PLAY_CONTINUES}`;
  } finally {
    if (current === epoch) profileLoading.value = false;
  }
  // Clears are sent with or without a name, so a failed check does not wait.
  await synchronize();
}

async function registerProfile(): Promise<void> {
  const accountId = id.value;
  const name = sharedName.value ?? validateGameName(gameName.value);
  if (!accountId || !consent.value || !name || busy.value) return;
  const current = epoch;
  busy.value = true;
  try {
    const response = await accountFetch(accountId, "/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: name,
        consentVersion: RANKING_CONSENT_VERSION,
      }),
    });
    if (current !== epoch) return;
    if (response.status === 409) {
      message.value =
        "このプレイヤー名はほかの人が使っています。別の名前にしてください。";
      return;
    }
    if (!response.ok) throw new Error("Registration failed.");
    const data: { profile: AccountProfile } = await response.json();
    if (current !== epoch) return;
    profile.value = data.profile;
    saveCachedProfile(accountId, data.profile, cacheStorage);
    emit("profile", data.profile.displayName);
    message.value =
      data.profile.displayName === name
        ? "設定しました。これから初めて解く問題のクリアが、ランキングに載ります。"
        : "設定しました。この ID にはほかのゲームで決めた名前があるため、その名前を使います。";
    await synchronize();
  } catch {
    if (current === epoch)
      message.value = `プレイヤー名を設定できません。${PRESS_AGAIN_ONLINE}`;
  } finally {
    busy.value = false;
  }
}

const waitingText = (count: number) =>
  `未送信${count}件。接続が戻ると自動で送ります。`;

/** After a send: what was dropped for good, and what still waits. */
function syncResultText(waiting: number, rejected: number): string {
  const dropped = rejected
    ? `${rejected}件はサーバーにある記録と食い違うため送りませんでした。この端末の履歴には残っています。`
    : "";
  if (waiting) return `${dropped}${waitingText(waiting)}`;
  return dropped || "同期済み";
}

async function synchronize(): Promise<void> {
  const accountId = id.value;
  if (!accountId || syncing.value || disposed) return;
  const current = epoch;
  pendingCount.value = outbox.count(accountId);
  if (!pendingCount.value) {
    syncMessage.value = "同期済み";
    return;
  }
  if (!navigator.onLine) {
    syncMessage.value = waitingText(pendingCount.value);
    return;
  }
  syncing.value = true;
  syncMessage.value = "送信しています…";
  emit("sending", true);
  let ranking: SyncedRanking | undefined;
  let rejected = 0;
  try {
    const sent = await outbox.drain(
      accountId,
      () => !disposed && current === epoch,
      async (play) => {
        const upload = await createCompletedPlayUpload(play);
        if (current !== epoch) throw new Error("Account changed.");
        const response = await accountFetch(accountId, "/api/plays", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(upload),
        });
        // The server holds a different record under this play's ID and keeps
        // it; sending again cannot change that.
        if (response.status === 409) {
          rejected += 1;
          return "rejected";
        }
        if (!response.ok) throw new Error("upload_failed");
        // 記録は登録済みなので、ランキングを読めなくても送信は成功とする。
        const body = (await response.json().catch(() => null)) as {
          entries?: unknown;
        } | null;
        // 形が想定と違う応答は使わない。画面は従来どおり取得し直す。
        const entries = body?.entries;
        ranking =
          Array.isArray(entries) &&
          entries.every(
            (entry) =>
              entry !== null &&
              typeof entry === "object" &&
              typeof entry.displayName === "string" &&
              Number.isSafeInteger(entry.rank),
          )
            ? { puzzleId: upload.puzzleId, entries }
            : undefined;
      },
    );
    if (current !== epoch || disposed) return;
    syncMessage.value = syncResultText(outbox.count(accountId), rejected);
    if (sent) {
      emit("synced", ranking);
    }
  } catch {
    if (current === epoch && !disposed)
      syncMessage.value = syncResultText(outbox.count(accountId), rejected);
  } finally {
    syncing.value = false;
    emit("sending", false);
    if (current === epoch) {
      pendingCount.value = outbox.count(accountId);
      if (outbox.persistenceFailed)
        syncMessage.value +=
          " 送信待ちの記録をこの端末に保存できません。この画面を閉じると送れなくなる場合があります。";
    }
  }
}

async function issueCode(): Promise<void> {
  if (!id.value || busy.value) return;
  const current = epoch;
  busy.value = true;
  try {
    const issued = await issueTransferCode();
    if (current !== epoch) return;
    if (issued.ok) {
      transferCode.value = { code: issued.code, expiresAt: issued.expiresAt };
      message.value = "";
    } else
      message.value =
        issued.reason === "offline"
          ? PRESS_AGAIN_ONLINE
          : "引き継ぎコードを発行できません。少し待ってから、もう一度押してください。";
  } finally {
    busy.value = false;
  }
}

async function redeemCode(): Promise<void> {
  const code = enteredCode.value.trim();
  if (!code || busy.value) return;
  if (
    !(await askConfirm({
      title: "この端末を引き継ぎますか？",
      message:
        "この端末を、引き継ぎコードを発行した端末と同じ ID に切り替えます。この端末でいま使っている ID の記録は、切り替え後の ID には移りません。",
      confirmLabel: "引き継ぐ",
    }))
  )
    return;
  busy.value = true;
  try {
    const redeemed = await redeemTransferCode(code);
    if (redeemed.ok) {
      enteredCode.value = "";
      // The ID watcher above has started this screen over by now.
      message.value = "引き継ぎました。";
      return;
    }
    message.value =
      redeemed.reason === "invalid"
        ? "引き継ぎコードが違うか、期限が切れています。発行した端末で、新しいコードを発行してください。"
        : redeemed.reason === "rate_limited"
          ? "入力が多すぎます。1分ほど待ってから、もう一度押してください。"
          : redeemed.reason === "offline"
            ? PRESS_AGAIN_ONLINE
            : "引き継げません。少し待ってから、もう一度押してください。";
  } finally {
    busy.value = false;
  }
}

function reconnect(): void {
  void loadProfile();
}
onMounted(() => {
  window.addEventListener("online", reconnect);
  retryTimer = setInterval(() => {
    void synchronize();
  }, 30000);
});
// 破棄後の emit は届かないので、送信中の表示が残らないよう破棄の前に解除する。
onBeforeUnmount(() => emit("sending", false));
onUnmounted(() => {
  disposed = true;
  window.removeEventListener("online", reconnect);
  clearInterval(retryTimer);
});
</script>

<template>
  <div
    v-if="open"
    class="dialog-backdrop"
    role="presentation"
    @click.self="emit('close')"
  >
    <section
      ref="dialogRef"
      class="dialog-card account-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-title"
      tabindex="-1"
      @keydown="onAccountKeydown"
    >
      <div class="dialog-header">
        <h2 id="account-title">アカウント</h2>
        <button
          type="button"
          class="dialog-close"
          aria-label="アカウントを閉じる"
          @click="emit('close')"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <p v-if="!id && status === 'loading'" role="status">
        この端末の ID を確認しています…
      </p>
      <p v-else-if="!id">
        この端末の ID をまだ確認できません。接続が戻ると確認します。{{
          PLAY_CONTINUES
        }}
      </p>
      <p v-else-if="profileLoading && !profile" role="status">
        オンライン設定を確認しています…
      </p>
      <template v-else>
        <form
          v-if="!profile"
          class="account-setup"
          @submit.prevent="registerProfile"
        >
          <h3>プレイヤー名を決める</h3>
          <template v-if="sharedName">
            <p>
              この ID には、kan-game.app のほかのゲームで決めたプレイヤー名
              <GameName :name="sharedName" />
              があります。TAKO-SEN でもこの名前を使います。
            </p>
          </template>
          <template v-else>
            <label for="account-name">プレイヤー名</label>
            <input
              id="account-name"
              ref="nameInputRef"
              v-model="gameName"
              required
              autocomplete="off"
              :aria-invalid="nameProblem ? 'true' : undefined"
              aria-describedby="account-name-rules account-name-problem"
            />
            <p
              id="account-name-problem"
              class="account-problem"
              aria-live="polite"
              v-text="nameProblem"
            ></p>
            <p id="account-name-rules" class="account-note">
              {{ GAME_NAME_MIN }}〜{{
                GAME_NAME_MAX
              }}文字。文字・数字・絵文字・空白・ハイフン（-）・下線（_）を使えます。「・」などの記号は使えません。ランキングに表示されるので、本名やメールアドレスは使わないでください。kan-game.app
              のほかのゲームでも同じ名前を使い、あとから変えられません。
            </p>
          </template>
          <p class="account-note">
            同意したあとに初めて解いた問題は、最初のクリアの成績が公開ランキングに載ります。名前を決める前に解いた問題は、解き直しても載りません。再挑戦は自分の履歴だけに残ります。非公開の設定はなく、退会すると公開記録とプレイヤー名を削除します（ほかの人が保存したコピーは消せません）。
          </p>
          <label class="account-consent"
            ><input v-model="consent" type="checkbox" required />
            この公開ルールに同意する</label
          >
          <button
            type="submit"
            :disabled="!!submitHint"
            :aria-describedby="submitHint ? 'account-submit-hint' : undefined"
          >
            {{
              sharedName ? "同意して参加する" : "プレイヤー名を設定して参加する"
            }}
          </button>
          <p v-if="submitHint" id="account-submit-hint" class="account-note">
            {{ submitHint }}
          </p>
        </form>
        <p class="account-sync">
          <template v-if="profile"
            ><GameName :name="profile.displayName" /> ·
          </template>
          <span aria-live="polite">{{ syncMessage }}</span>
          <button
            v-if="pendingCount && !syncing"
            type="button"
            class="account-resend"
            @click="synchronize"
          >
            今すぐ送る
          </button>
        </p>
        <p v-if="profile">
          ランキングは各問題の初回クリアのみ。再挑戦も個人履歴に自動保存します。
        </p>
        <p class="account-note">
          <template v-if="!profile">{{ ID_STORAGE_NOTE }}</template
          ><a :href="privacyUrl" target="_blank" rel="noopener"
            >プライバシーポリシー</a
          >
        </p>
        <section
          class="account-transfer"
          aria-labelledby="account-transfer-title"
        >
          <h3 id="account-transfer-title">別の端末と引き継ぐ</h3>
          <p v-if="transferCode" class="account-code">
            引き継ぎコード
            <strong>{{ transferCode.code }}</strong>
            （{{ transferExpiry }}まで有効。1回だけ使えます）
          </p>
          <button
            type="button"
            :aria-disabled="busy || undefined"
            @click="issueCode"
          >
            この端末の引き継ぎコードを発行
          </button>
          <form class="account-redeem" @submit.prevent="redeemCode">
            <label for="account-transfer-code"
              >ほかの端末で発行したコード</label
            >
            <input
              id="account-transfer-code"
              v-model="enteredCode"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
            />
            <button type="submit" :aria-disabled="busy || undefined">
              引き継ぐ
            </button>
          </form>
        </section>
      </template>
      <p class="account-message" aria-live="polite" v-text="message"></p>
      <p class="account-note">
        復旧コードの発行と入力、退会は、kan-game.app の<a
          :href="accountUrl"
          target="_blank"
          rel="noopener"
          >アカウント画面</a
        >で行います。
      </p>
    </section>
  </div>
</template>
