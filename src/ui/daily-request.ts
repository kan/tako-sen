import { ref } from "vue";

/**
 * A request to open the daily challenge, made by the daily notice: tapping it
 * loads `/?daily=1`, in a new window or in the one already showing the game
 * (public/push-sw.js). App.vue opens the daily as its button would and clears
 * the request.
 */
export const dailyRequested = ref(false);

const PARAM = "daily";

/** Takes `?daily=1` off the address (so a reload does not open it again). */
export function takeDailyRequestFromUrl(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(PARAM)) return;
  url.searchParams.delete(PARAM);
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  dailyRequested.value = true;
}
