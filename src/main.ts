import { createApp } from "vue";
import App from "./App.vue";
import { installAuth } from "./ui/auth";
import "./styles.css";

const app = createApp(App);
installAuth(app);
app.mount("#app");
