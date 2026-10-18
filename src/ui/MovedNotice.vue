<script setup lang="ts">
import { computed, ref } from "vue";
import { handoffUrl } from "../core/handoff-link";
import { SignInButton, onlineAuthEnabled, useAuth } from "./auth";

/**
 * Shown instead of the game once TAKO-SEN has moved to kan-game.app
 * (src/worker/moved.ts). A signed-in player takes their records over with
 * their migration token; anyone can go over with their settings alone.
 */
const props = defineProps<{ target: string; endsOn: string }>();

// A build without Clerk cannot sign anyone in; it still sends players over.
const auth = onlineAuthEnabled ? useAuth() : undefined;
const status = ref<
  | "idle"
  | "working"
  | "no_records"
  | "preparing"
  | "expired"
  | "ended"
  | "failed"
>("idle");

const host = computed(() => new URL(props.target).host);
const endsOnText = computed(() => {
  const [year, month, day] = props.endsOn.split("-").map(Number);
  return `${year}年${month}月${day}日`;
});
// After the last day in Japan, as the Worker decides (migrationEnded).
const ended = computed(
  () => Date.now() > Date.parse(`${props.endsOn}T23:59:59.999+09:00`),
);

function go(token?: string): void {
  window.location.assign(
    handoffUrl(props.target, window.location, localStorage, token),
  );
}

async function moveWithRecords(): Promise<void> {
  if (!auth || status.value === "working") return;
  status.value = "working";
  try {
    const session = await auth.getToken();
    const response = await fetch("/api/migration-handoff", {
      headers: session ? { Authorization: `Bearer ${session}` } : {},
    });
    if (response.ok) {
      const { token } = (await response.json()) as { token?: unknown };
      // The new URL ignores anything else, so going would lose the records.
      if (typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token)) {
        go(token);
        return;
      }
      status.value = "failed";
      return;
    }
    if (response.status === 401 && !session) {
      // The session ran out while the page was open: sign out here too, so
      // the sign-in button comes back. A 401 despite a session is the
      // site's fault, and signing in again would not help.
      status.value = "expired";
      await auth.signOut().catch(() => undefined);
      return;
    }
    const { error } = (await response.json().catch(() => ({}))) as {
      error?: unknown;
    };
    status.value =
      response.status === 404
        ? "no_records"
        : response.status === 410
          ? "ended"
          : response.status === 503 && error === "preparing"
            ? "preparing"
            : "failed";
  } catch {
    status.value = "failed";
  }
}
</script>

<template>
  <main class="moved">
    <h1>TAKO-SEN は引っ越しました</h1>
    <p>
      新しい URL は <strong>{{ host }}</strong> です。この URL では遊べません。
    </p>

    <section v-if="auth" class="moved-section" aria-labelledby="moved-records">
      <h2 id="moved-records">記録を引き継ぐ</h2>
      <template v-if="ended || status === 'ended'">
        <p>
          記録を引き継げる期間は {{ endsOnText }} で終わりました。
          引き継がれなかった記録とプレイヤー名は、新しい URL
          のランキングにそのまま残っています。
        </p>
      </template>
      <template v-else>
        <p>
          これまでログインしていた方は、ログインすると、オンラインの履歴、ランキングの記録、プレイヤー名、超級の進捗を新しい
          URL へ引き継げます。引き継げるのは {{ endsOnText }} までです。
        </p>
        <p>
          新しい URL
          で遊ぶ前に引き継いでください。先に遊んだ記録は、引き継いだ記録とは別のままになります。
        </p>
        <button
          v-if="!auth.isLoaded.value"
          type="button"
          class="moved-primary"
          disabled
        >
          ログインの状態を確かめています
        </button>
        <SignInButton v-else-if="!auth.isSignedIn.value">
          <button type="button" class="moved-primary">
            ログインして引き継ぐ
          </button>
        </SignInButton>
        <button
          v-else
          type="button"
          class="moved-primary"
          :disabled="status === 'working'"
          @click="moveWithRecords"
        >
          記録を引き継いで移る
        </button>
        <p v-if="status === 'no_records'" class="moved-message" role="status">
          このアカウントには引き継ぐ記録がありません。下の「新しい URL
          へ移る」を押してください。
        </p>
        <p
          v-else-if="status === 'preparing'"
          class="moved-message"
          role="status"
        >
          引き継ぎの準備中です。数分待ってから、もう一度押してください。
        </p>
        <p v-else-if="status === 'expired'" class="moved-message" role="alert">
          ログインが切れていました。もう一度ログインしてから引き継いでください。
        </p>
        <p v-else-if="status === 'failed'" class="moved-message" role="alert">
          引き継ぎの準備ができませんでした。通信を確かめて、もう一度押してください。
        </p>
      </template>
    </section>

    <section class="moved-section" aria-labelledby="moved-settings">
      <h2 id="moved-settings">ログインせずに移る</h2>
      <p>
        設定（自動×、難易度、効果音、振動、遊び方の既読）だけを引き継ぎます。
      </p>
      <button type="button" @click="go()">新しい URL へ移る</button>
    </section>

    <p class="moved-note">
      この端末のローカル成績、遊びかけの盤面、送信していない記録は引き継げません。
    </p>
  </main>
</template>
