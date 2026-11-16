/**
 * The Worker's entry (wrangler.jsonc `main`): the HTTP API and cron of
 * index.ts, and GameService, the named entrypoint the ID platform calls.
 * index.ts does not import `cloudflare:workers`, so scripts run in Node can
 * still import what it imports.
 */
export { default } from "./index";
export { GameService } from "./game-service";
