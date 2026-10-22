import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";
import {
  licensesPlugin,
  SERVER_PACKAGES,
  SERVICE_WORKER_PACKAGES,
} from "./scripts/licenses-plugin.ts";

export default defineConfig({
  plugins: [
    vue(),
    licensesPlugin({
      serviceWorker: SERVICE_WORKER_PACKAGES,
      server: SERVER_PACKAGES,
    }),
    // An installable app with a service worker, as vegtab has
    // (vegtab frontend/vite.config.ts). The worker keeps the screens for
    // offline starts and shows the daily notice (public/push-sw.js).
    VitePWA({
      registerType: "autoUpdate",
      // The manifest's icons are left to the globs below.
      includeManifestIcons: false,
      // Registered from src/main.ts, after the screens are up.
      injectRegister: false,
      manifest: {
        name: "TAKO-SEN",
        short_name: "TAKO-SEN",
        description: "タコを置いていくロジックパズル",
        lang: "ja",
        theme_color: "#fff7ec",
        background_color: "#fff7ec",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/pwa-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // licenses.json, so the About dialog lists them offline too. Named
        // alone, so no other JSON joins the precache by accident.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}", "licenses.json"],
        // Not needed offline: the large icons are fetched by the system when
        // the app is added, and push-sw.js is part of the worker itself.
        globIgnores: [
          "pwa-512.png",
          "pwa-maskable-512.png",
          "apple-touch-icon.png",
          "push-sw.js",
        ],
        // Every page is the app; the API is never answered from the cache.
        // Its answers depend on the device's ID cookie, which a cache key
        // does not see: vegtab once served the old account's answers after
        // a transfer.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        importScripts: ["/push-sw.js"],
        // A new version takes over at once (registerType "autoUpdate" then
        // reloads the page) and the old version's files go. Without these
        // the new worker waited until every tab of the game was closed.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
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
