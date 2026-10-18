import { createApp, h } from "vue";
import MovedNotice from "./ui/MovedNotice.vue";
import { installAuth } from "./ui/auth";
import type { Moved } from "./worker/moved";
import "./styles.css";

/**
 * Where TAKO-SEN moved, or null while the game runs here
 * (src/worker/moved.ts). Without an answer (mostly offline) the game starts
 * as before and can be played on this device: the Worker refuses its
 * writes once the site has moved.
 */
async function movedTo(): Promise<Moved | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch("/api/moved", { signal: controller.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<Moved> | null;
    return typeof body?.target === "string" && typeof body.endsOn === "string"
      ? { target: body.target, endsOn: body.endsOn }
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// The game is fetched only when it will be shown, so after the move the
// notice neither waits for it nor depends on it.
void movedTo().then(async (moved) => {
  const app = moved
    ? createApp({ render: () => h(MovedNotice, moved) })
    : createApp((await import("./App.vue")).default);
  installAuth(app);
  app.mount("#app");
});
