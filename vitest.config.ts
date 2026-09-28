import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "node",
    testTransformMode: { web: ["**/tests/online-ui.test.ts"] },
  },
});
