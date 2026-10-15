<script setup lang="ts">
import { useAuth } from "./auth";
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from "vue";
import GameName from "./GameName.vue";
import { trapDialogFocus } from "./dialog";
import { createCompletedPlayUpload } from "../core/online-history";
import {
  RANKING_CONSENT_VERSION,
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
let epoch = 0;
let disposed = false;
let retryTimer: ReturnType<typeof setInterval> | undefined;

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
      message.value =
        "オンライン設定を確認できません。再試行できます。オフラインでのプレイは続けられます。";
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
      message.value = "この名前は使われています。別の名前を選んでください。";
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
      "設定しました。これからのクリアを自動同期します。過去のローカル履歴は送信しません。";
    await synchronize();
  } catch {
    if (current === epoch)
      message.value = "設定を保存できません。再試行してください。";
  } finally {
    busy.value = false;
  }
}

async function synchronize(): Promise<void> {
  const accountId = userId.value;
  if (!accountId || !profile.value || syncing.value || disposed) return;
  const current = epoch;
  const pending = outbox.count(accountId);
  if (!pending) {
    syncMessage.value = "同期済み";
    return;
  }
  if (!navigator.onLine) {
    syncMessage.value = `未送信 ${pending} 件 · 接続後に自動再送します`;
    return;
  }
  syncing.value = true;
  syncMessage.value = "同期中…";
  emit("sending", true);
  let ranking: SyncedRanking | undefined;
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
        if (!response.ok)
          throw new Error(
            response.status === 409 ? "conflict" : "upload_failed",
          );
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
    syncMessage.value = outbox.count(accountId)
      ? `未送信 ${outbox.count(accountId)} 件`
      : "同期済み";
    if (sent) {
      emit("synced", ranking);
    }
  } catch (error) {
    if (current === epoch && !disposed)
      syncMessage.value = String(error).includes("conflict")
        ? "記録が競合しています。ローカル記録は保持しています。"
        : `未送信 ${outbox.count(accountId)} 件 · 再接続後に自動再送します`;
  } finally {
    syncing.value = false;
    emit("sending", false);
    if (current === epoch && outbox.persistenceFailed)
      syncMessage.value +=
        " · 未送信データを端末に保存できません。この画面を閉じると再送できない場合があります。";
  }
}

async function deleteAccount(): Promise<void> {
  const accountId = userId.value;
  if (!accountId || busy.value) return;
  if (
    !(await askConfirm({
      title: "退会しますか？",
      message:
        "アカウント、ゲーム名、オンライン履歴、すべてのランキング記録を削除します。端末のローカル履歴は残ります。元に戻せません。",
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
        "退会処理を確認できません。ログインできる場合は再試行してください。";
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
          {{ setupOnly ? "ゲーム名を設定" : "アカウント" }}
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
      <p v-if="!isLoaded || profileLoading">オンライン設定を確認しています。</p>
      <template v-else-if="isSignedIn">
        <form v-if="!profile" @submit.prevent="registerProfile">
          <h2 v-if="!setupOnly">ゲーム名を決める</h2>
          <label
            >ゲーム名
            <input
              ref="nameInputRef"
              v-model="gameName"
              required
              autocomplete="off"
          /></label>
          <p>
            2〜20文字の文字・数字・絵文字・空白・ハイフン・下線を使えます。本名やメールアドレスは使わないでください。名前はランキングに表示されます。
          </p>
          <p>
            設定後はログイン中のクリアを自動同期し、各問題で最初にサーバーへ登録された成績を公開ランキングに載せます。再挑戦は個人履歴だけに残ります。過去のローカル履歴は送信しません。
          </p>
          <p>
            個別の非公開設定はありません。公開記録とゲーム名は退会すると削除されます。第三者が保存したコピーは回収できません。
          </p>
          <label
            ><input v-model="consent" type="checkbox" required />
            この公開ルールに同意する</label
          >
          <button
            type="submit"
            :disabled="busy || !consent || !validateGameName(gameName)"
          >
            ゲーム名を設定して参加する
          </button>
        </form>
        <template v-else-if="!setupOnly">
          <p>
            <GameName :name="profile.displayName" /> ·
            <span aria-live="polite">{{ syncMessage }}</span>
          </p>
          <p>
            ランキングは各問題の初回クリアのみ。再挑戦も個人履歴に自動保存します。
          </p>
        </template>
        <button
          v-if="!setupOnly"
          type="button"
          :disabled="busy"
          @click="signOut()"
        >
          ログアウト
        </button>
      </template>
      <p v-else>
        ログインしてゲーム名を設定すると、クリアの自動同期とランキング参加ができます。ログインなしでも遊べます。
      </p>
      <p v-if="message" aria-live="polite">{{ message }}</p>
      <button
        v-if="isSignedIn && !setupOnly"
        type="button"
        :disabled="busy"
        @click="deleteAccount"
      >
        退会してオンライン履歴を削除
      </button>
    </section>
  </div>
</template>
