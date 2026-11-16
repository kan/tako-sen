import type { D1Migration } from "cloudflare:test";

// Bindings only the Worker's tests have (vitest.config.ts).
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
