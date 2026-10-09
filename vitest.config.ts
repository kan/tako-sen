import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  // UI tests mock Clerk; never depend on a developer's .env.local or real keys.
  define: {
    "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify("test-only"),
  },
  test: {
    environment: "node",
    testTransformMode: { web: ["**/tests/online-ui.test.ts"] },
  },
});
