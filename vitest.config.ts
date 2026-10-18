import { configDefaults, defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

const uiTests = ["tests/online-ui.test.ts"];

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "node",
    // CI runs D1 and generator tests beside the CPU-heavy audit; several take 3-5s there.
    testTimeout: 30000,
    // The UI tests mount components with Vue's client renderer, so their
    // modules must be transformed for the browser rather than for SSR.
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          exclude: [...configDefaults.exclude, ...uiTests],
        },
      },
      {
        extends: true,
        // The client transform would inline /tako.svg as a data URL; the
        // production build keeps it as a URL, so keep it one here too.
        build: { assetsInlineLimit: 0 },
        test: {
          name: "ui",
          include: uiTests,
          environment: "./tests/client-environment.ts",
        },
      },
    ],
  },
});
