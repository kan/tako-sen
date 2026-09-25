import { createApp } from "vue";
import { clerkPlugin } from "@clerk/vue";
import App from "./App.vue";
import "./styles.css";

const app = createApp(App);
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (publishableKey) {
  app.use(clerkPlugin, { publishableKey });
}
app.mount("#app");
