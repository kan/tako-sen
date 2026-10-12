import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    // Vite admits *.localhost by itself; roji's domain can be another one.
    allowedHosts: process.env.ROJI_HOST ? [process.env.ROJI_HOST] : undefined,
    proxy: {
      // scripts/dev.mjs starts the API on a free port and names it here.
      "/api": `http://127.0.0.1:${process.env.TAKO_API_PORT || 8787}`,
    },
  },
});
