import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { configDefaults, defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

const uiTests = ["tests/online-ui.test.ts"];
// The Worker's tests run in the Workers runtime (workerd), against a local D1.
const workerTests = [
  "tests/achievements-worker.test.ts",
  "tests/daily-worker.test.ts",
  "tests/entrypoint.test.ts",
  "tests/id-auth.test.ts",
  "tests/leaderboard.test.ts",
  "tests/next-puzzle-worker.test.ts",
  "tests/push-worker.test.ts",
  "tests/super-worker.test.ts",
  "tests/weekly-ranking.test.ts",
  "tests/worker-history.test.ts",
];

export default defineConfig(async () => ({
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
          exclude: [...configDefaults.exclude, ...uiTests, ...workerTests],
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
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./tests/wrangler.jsonc" },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations("./migrations"),
              },
            },
          }),
        ],
        test: {
          name: "worker",
          include: workerTests,
          testTimeout: 30000,
        },
      },
    ],
  },
}));
