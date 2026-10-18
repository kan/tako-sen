import { ref, watch } from "vue";
import { apiFetch, idWithdrawals, useId } from "./auth";

/**
 * The daily notice on this device (kan/tako-sen#10, src/worker/push.ts),
 * after vegtab's SettingsModal.vue. The subscription belongs to the device;
 * the server keeps it under the device's current ID.
 */
export type PushState =
  | "checking"
  /** The browser has no Web Push. */
  | "unsupported"
  /** iPhone or iPad: only an app added to the home screen gets push. */
  | "install"
  /** The server has no key (local development) or did not answer. */
  | "unavailable"
  /** The player or the device turned notifications off for the site. */
  | "denied"
  | "off"
  | "on";

export type PushProblem = "failed" | "offline" | "too_many";

export const pushState = ref<PushState>("checking");
export const pushBusy = ref(false);
export const pushProblem = ref<PushProblem>();

function isAppleTouchDevice(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

let knownKey: string | undefined;
/**
 * The server's VAPID public key, or "" where push is not set up. Only a key
 * is kept: an answer that failed is asked again next time.
 */
async function publicKey(): Promise<string> {
  if (knownKey) return knownKey;
  try {
    const response = await fetch("/api/push/key");
    if (!response.ok) return "";
    const { publicKey } = (await response.json()) as { publicKey?: unknown };
    if (typeof publicKey !== "string") return "";
    if (publicKey) knownKey = publicKey;
    return publicKey;
  } catch {
    return "";
  }
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function sameBytes(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.length) return false;
  const bytes = new Uint8Array(a);
  return bytes.every((byte, i) => byte === b[i]);
}

let knownRegistration: ServiceWorkerRegistration | undefined;
/**
 * The service worker the build registers (src/main.ts); none in `vite`.
 * Only one that was found is kept: on a first start it may still be on its
 * way, and is looked for again next time.
 */
async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  if (knownRegistration) return knownRegistration;
  if (!("serviceWorker" in navigator)) return undefined;
  knownRegistration =
    (await navigator.serviceWorker.getRegistration()) ??
    (await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<undefined>((resolve) => setTimeout(resolve, 3000)),
    ]));
  return knownRegistration;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  return (await registration())?.pushManager.getSubscription() ?? null;
}

/** Looks at the browser and the server again (when the setting is shown). */
export async function refreshPushState(): Promise<void> {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    pushState.value =
      isAppleTouchDevice() && !isStandalone() ? "install" : "unsupported";
    return;
  }
  const found = await registration();
  if (!(await publicKey()) || !found) {
    pushState.value = "unavailable";
    return;
  }
  if (Notification.permission === "denied") {
    pushState.value = "denied";
    return;
  }
  pushState.value = (await found.pushManager.getSubscription()) ? "on" : "off";
}

function pushApi(method: "POST" | "DELETE", body: unknown) {
  return apiFetch("/api/push/subscription", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * The ID and endpoint the server last took, so a start sends the
 * subscription only when one of them changed.
 */
const SYNCED_KEY = "tako-sen.push-synced";

function syncedMark(subscription: PushSubscription): string {
  return `${useId().id.value ?? ""} ${subscription.endpoint}`;
}

function readSynced(): string | null {
  try {
    return localStorage.getItem(SYNCED_KEY);
  } catch {
    return null;
  }
}

function rememberSynced(mark: string | null): void {
  try {
    if (mark) localStorage.setItem(SYNCED_KEY, mark);
    else localStorage.removeItem(SYNCED_KEY);
  } catch {
    // Without storage every start sends it again, which is harmless.
  }
}

async function sendSubscription(subscription: PushSubscription) {
  const mark = syncedMark(subscription);
  const response = await pushApi("POST", subscription.toJSON());
  if (response.ok) rememberSynced(mark);
  return response;
}

export async function enablePush(): Promise<void> {
  if (pushBusy.value) return;
  pushBusy.value = true;
  pushProblem.value = undefined;
  let subscription: PushSubscription | null = null;
  let saved = false;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      pushState.value = permission === "denied" ? "denied" : "off";
      return;
    }
    const found = await registration();
    const key = await publicKey();
    if (!found || !key) {
      pushState.value = "unavailable";
      return;
    }
    const serverKey = keyBytes(key);
    subscription = await found.pushManager.getSubscription();
    // One made for an earlier key pair would never receive anything.
    if (
      subscription &&
      !sameBytes(subscription.options.applicationServerKey, serverKey)
    ) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await found.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: serverKey,
    });
    const response = await sendSubscription(subscription);
    saved = response.ok;
    if (!saved)
      pushProblem.value = response.status === 409 ? "too_many" : "failed";
  } catch {
    pushProblem.value = navigator.onLine ? "failed" : "offline";
  } finally {
    // Not on the server, so nothing would arrive: undo it here as well, so
    // the setting does not show on.
    if (subscription && !saved)
      await subscription.unsubscribe().catch(() => false);
    if (subscription) pushState.value = saved ? "on" : "off";
    pushBusy.value = false;
  }
}

export async function disablePush(): Promise<void> {
  if (pushBusy.value) return;
  pushBusy.value = true;
  pushProblem.value = undefined;
  try {
    const subscription = await currentSubscription();
    if (subscription) {
      // The device stops listening either way; a row left on the server is
      // deleted the first time its push service answers that it is gone.
      await pushApi("DELETE", { endpoint: subscription.endpoint }).catch(
        () => undefined,
      );
      await subscription.unsubscribe();
    }
    rememberSynced(null);
    pushState.value = "off";
  } catch {
    pushProblem.value = "failed";
    await refreshPushState();
  } finally {
    pushBusy.value = false;
  }
}

/**
 * Keeps the server's copy with the device's current ID: once at start and
 * whenever the ID changes (a transfer code, a QR code, the old URL's link),
 * a device that has notices on sends its subscription again. A withdrawal
 * is different: the notice went with the withdrawn ID, so the device stops
 * listening instead of carrying it over to the next ID.
 */
export function startPushSync(): void {
  const { id } = useId();
  watch(idWithdrawals, async () => {
    try {
      await (await currentSubscription())?.unsubscribe();
    } catch {
      // The server row is gone already; nothing more to send.
    }
    rememberSynced(null);
    if (pushState.value === "on") pushState.value = "off";
  });
  watch(
    id,
    async (current) => {
      if (!current || !("serviceWorker" in navigator)) return;
      try {
        const subscription = await currentSubscription();
        if (subscription && readSynced() !== syncedMark(subscription))
          await sendSubscription(subscription);
      } catch {
        // Tried again with the next start or ID.
      }
    },
    { immediate: true },
  );
}
