/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The kan-game.app portal for local development, where the game is not on
   * a kan-game.app host (src/ui/auth.ts portalUrl). Defaults to kan/game's
   * `wrangler dev` at http://localhost:8787.
   */
  readonly VITE_KAN_GAME_PORTAL?: string;
}
