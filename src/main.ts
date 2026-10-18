import { createApp } from "vue";
import App from "./App.vue";
import { startId } from "./ui/auth";
import "./styles.css";

startId();
createApp(App).mount("#app");
