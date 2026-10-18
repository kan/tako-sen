import { createApp } from "vue";
import App from "./App.vue";
import { applyHandoffSettings, parseHandoff } from "./core/handoff";
import { startId } from "./ui/auth";
import { offerMigration, offerTransfer } from "./ui/migration";
import "./styles.css";

/**
 * Takes what the address carries from the old URL or another device's QR code
 * (src/core/handoff.ts). The fragment leaves the address bar at once, so a
 * reload or a shared link does not carry the secret on, and the ID switches
 * only after the player agrees in the dialog.
 */
function takeHandoff(atStart: boolean): void {
  const handoff = parseHandoff(window.location.hash);
  if (!handoff) return;
  history.replaceState(
    history.state,
    "",
    window.location.pathname + window.location.search,
  );
  // The screens read the settings once, as they start, so only then.
  if (atStart)
    try {
      applyHandoffSettings(localStorage, handoff.settings);
    } catch {
      // Without site data the settings stay at their defaults.
    }
  if (handoff.migrationToken) offerMigration(handoff.migrationToken);
  else if (handoff.transferCode) offerTransfer(handoff.transferCode);
}

// Before the screens read the settings and before mounting, so they see the
// offer and hold the tutorial back.
takeHandoff(true);
startId();
createApp(App).mount("#app");
// A QR code opened in a tab already showing the game changes only the
// fragment, which does not load the page again.
window.addEventListener("hashchange", () => takeHandoff(false));
