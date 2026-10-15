<script setup lang="ts">
import { useAuth } from "./auth";
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
import { PLAY_CONTINUES } from "./notice-text";
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
  setupOnly?: boolean;
}>();
const emit = defineEmits<{
  /** 送信に成功した。最後に送った記録の問題のランキングが応答にあれば添える。 */
  synced: [ranking?: SyncedRanking];
  /** 記録の送信中かどうか。送信中は、送信後に届くランキングを待てる。 */
  sending: [active: boolean];
  profile: [name: string];
  setupRequired: [required: boolean];
  close: [];
}>();
const dialogRef = ref<HTMLElement>();
const nameInputRef = ref<HTMLInputElement>();
const { getToken, isLoaded, isSignedIn, signOut, userId } = useAuth();
const cacheStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
} satisfies import("../core/storage").KeyValueStorage;
const outbox = new SyncOutbox(props.plays, cacheStorage);
const profile = ref<AccountProfile | null>(null);
const profileLoading = ref(false);
const gameName = ref("");
const consent = ref(false);
const busy = ref(false);
const syncing = ref(false);
const message = ref("");
const syncMessage = ref("");
const pendingCount = ref(0);
let epoch = 0;
let disposed = false;
let retryTimer: ReturnType<typeof setInterval> | undefined;

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
  !gameName.value.trim()
    ? "プレイヤー名を入力してください。"
    : nameProblem.value
      ? "プレイヤー名を直してください。"
      : !consent.value
        ? "公開ルールに同意すると設定できます。"
        : "",
);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    if (props.setupOnly) nameInputRef.value?.focus();
    else dialogRef.value?.focus();
    void loadProfile();
  },
);

function onAccountKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    if (!props.setupOnly) emit("close");
    return;
  }
  trapDialogFocus(event, dialogRef.value);
}

watch(isSignedIn, (signedIn) => {
  if (!signedIn) emit("close");
});

watch(
  userId,
  () => {
    epoch += 1;
    emit("setupRequired", false);
    profileLoading.value = false;
    profile.value = userId.value
      ? loadCachedProfile(userId.value, cacheStorage)
      : null;
    gameName.value = "";
    consent.value = false;
    message.value = "";
    syncMessage.value = "";
    emit("profile", profile.value?.displayName ?? "");
    void loadProfile();
  },
  { immediate: true },
);

watch(
  () => props.plays,
  (plays) => {
    outbox.capture(
      plays,
      profile.value && isSignedIn.value ? (userId.value ?? null) : null,
    );
    void synchronize();
  },
  { flush: "sync" },
);

async function authenticatedFetch(
  accountId: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const current = epoch;
  if (disposed || current !== epoch || userId.value !== accountId)
    throw new Error("Account changed.");
  const token = await getToken();
  if (disposed || current !== epoch || userId.value !== accountId)
    throw new Error("Account changed.");
  if (!token) throw new Error("Session unavailable.");
  return fetch(path, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}` },
  });
}

async function loadProfile(): Promise<void> {
  const accountId = userId.value;
  if (!accountId || profileLoading.value) return;
  const current = epoch;
  profileLoading.value = true;
  try {
    const response = await authenticatedFetch(accountId, "/api/profile");
    if (!response.ok) throw new Error("Profile unavailable.");
    const data: { profile: AccountProfile | null } = await response.json();
    if (current !== epoch || disposed) return;
    profile.value = data.profile;
    profileLoading.value = false;
    saveCachedProfile(accountId, data.profile, cacheStorage);
    emit("profile", data.profile?.displayName ?? "");
    emit("setupRequired", data.profile === null);
    if (current === epoch) await synchronize();
  } catch {
    if (current === epoch && !disposed)
      message.value = `オンライン設定を確認できません。接続を確認して、アカウントを開き直してください。${PLAY_CONTINUES}`;
    if (current === epoch) await synchronize();
  } finally {
    if (current === epoch) profileLoading.value = false;
  }
}

async function registerProfile(): Promise<void> {
  const accountId = userId.value;
  const name = validateGameName(gameName.value);
  if (!accountId || !consent.value || !name || busy.value) return;
  const current = epoch;
  busy.value = true;
  try {
    const response = await authenticatedFetch(accountId, "/api/profile", {
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
    emit("setupRequired", false);
    message.value =
      "設定しました。これからのクリアを自動で送ります。過去のローカル履歴は送りません。";
    await synchronize();
  } catch {
    if (current === epoch)
      message.value =
        "プレイヤー名を設定できません。接続を確認して、もう一度押してください。";
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
  const accountId = userId.value;
  if (!accountId || !profile.value || syncing.value || disposed) return;
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
        const response = await authenticatedFetch(accountId, "/api/plays", {
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

async function deleteAccount(): Promise<void> {
  const accountId = userId.value;
  if (!accountId || busy.value) return;
  if (
    !(await askConfirm({
      title: "退会しますか？",
      message:
        "アカウント、プレイヤー名、オンライン履歴、すべてのランキング記録を削除します。端末のローカル履歴は残ります。元に戻せません。",
      confirmLabel: "退会する",
    }))
  )
    return;
  busy.value = true;
  try {
    const response = await authenticatedFetch(accountId, "/api/account", {
      method: "DELETE",
    });
    if (!response.ok) throw new Error("Deletion failed.");
    outbox.forget(accountId);
    saveCachedProfile(accountId, null, cacheStorage);
    if (userId.value !== accountId) return;
    profile.value = null;
    emit("profile", "");
    emit("synced");
    await signOut();
  } catch {
    if (userId.value === accountId)
      message.value =
        "退会できたか確認できません。接続を確認して、もう一度「退会してオンライン履歴を削除」を押してください。";
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
    @click.self="!setupOnly && emit('close')"
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
        <h2 id="account-title">
          {{ setupOnly ? "プレイヤー名を設定" : "アカウント" }}
        </h2>
        <button
          v-if="!setupOnly"
          type="button"
          class="dialog-close"
          aria-label="アカウントを閉じる"
          @click="emit('close')"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <p v-if="!isLoaded || profileLoading" role="status">
        オンライン設定を確認しています…
      </p>
      <template v-else-if="isSignedIn">
        <form
          v-if="!profile"
          class="account-setup"
          @submit.prevent="registerProfile"
        >
          <h3 v-if="!setupOnly">プレイヤー名を決める</h3>
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
            }}文字。文字・数字・絵文字・空白・ハイフン（-）・下線（_）を使えます。「・」などの記号は使えません。ランキングに表示されるので、本名やメールアドレスは使わないでください。
          </p>
          <p class="account-note">
            設定後は、ログイン中のクリアを自動で送ります。各問題で最初の成績が公開ランキングに載り、再挑戦は自分の履歴だけに残ります。過去の履歴は送りません。非公開の設定はなく、退会すると公開記録とプレイヤー名を削除します（他の人が保存したコピーは消せません）。
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
            プレイヤー名を設定して参加する
          </button>
          <p v-if="submitHint" id="account-submit-hint" class="account-note">
            {{ submitHint }}
          </p>
        </form>
        <template v-else-if="!setupOnly">
          <p class="account-sync">
            <GameName :name="profile.displayName" /> ·
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
          <p>
            ランキングは各問題の初回クリアのみ。再挑戦も個人履歴に自動保存します。
          </p>
        </template>
      </template>
      <p v-else>
        ログインしてプレイヤー名を設定すると、クリアの自動同期とランキング参加ができます。ログインなしでも遊べます。
      </p>
      <p class="account-message" aria-live="polite" v-text="message"></p>
      <!-- Busy leaves these enabled, so a focused button keeps focus; the
           handlers ignore a press while busy. -->
      <div v-if="isSignedIn" class="account-actions">
        <button
          type="button"
          :aria-disabled="busy || undefined"
          @click="!busy && signOut()"
        >
          ログアウト
        </button>
      </div>
      <div v-if="isSignedIn && !setupOnly" class="account-danger">
        <button
          type="button"
          class="danger-button"
          :aria-disabled="busy || undefined"
          @click="deleteAccount"
        >
          退会してオンライン履歴を削除
        </button>
      </div>
    </section>
  </div>
</template>
