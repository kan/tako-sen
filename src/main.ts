import { createApp } from "vue";
import App from "./App.vue";
import { applyHandoffSettings, parseHandoff } from "./core/handoff";
import { startId } from "./ui/auth";
import { offerMigration } from "./ui/migration";
import "./styles.css";

// Sent over from the old URL: settings are stored before the screens read
// them, and the fragment leaves the address bar so a reload or a shared link
// does not carry the token on (src/core/handoff.ts).
const handoff = parseHandoff(window.location.hash);
if (handoff) {
  history.replaceState(
    history.state,
    "",
    window.location.pathname + window.location.search,
  );
  try {
    applyHandoffSettings(localStorage, handoff.settings);
  } catch {
    // Without site data the settings stay at their defaults.
  }
}

startId();
// Before mounting, so the screens see the offer and hold the tutorial back.
if (handoff?.migrationToken) offerMigration(handoff.migrationToken);
createApp(App).mount("#app");
