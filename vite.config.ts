import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  build: {
    // Vite 6's default. Vite 8 raised it to Safari 16.4, but styles.css still
    // supports iOS Safari before 16.2, so keep the older browsers here.
    target: ["es2020", "edge88", "firefox78", "chrome87", "safari14"],
  },
  server: {
    // Vite admits *.localhost by itself; roji's domain can be another one.
    allowedHosts: process.env.ROJI_HOST ? [process.env.ROJI_HOST] : undefined,
    proxy: {
      // scripts/dev.mjs starts the API on a free port and names it here.
      "/api": `http://127.0.0.1:${process.env.TAKO_API_PORT || 8787}`,
    },
  },
});
