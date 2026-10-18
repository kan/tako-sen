import { WorkerEntrypoint } from "cloudflare:workers";
import type { GameService as GameServiceContract } from "./id-rpc";
import { deleteAccount } from "./history";

/**
 * What TAKO-SEN provides to the ID platform, which binds it as GAME_TAKO
 * (kan/game docs/ID_DESIGN.md「ゲームとの RPC」). A named entrypoint, so the
 * binding reaches this method only and not the HTTP API.
 */
export class GameService
  extends WorkerEntrypoint<Env>
  implements GameServiceContract
{
  /** Withdrawal: records the ID as deleted and deletes its records. */
  async deleteAccount(id: string): Promise<void> {
    if (typeof id !== "string" || id === "") throw new Error("invalid id");
    await deleteAccount(this.env.DB, id);
  }
}
