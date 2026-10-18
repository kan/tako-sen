import type { IdRpc, RegisterNameResult } from "../src/worker/id-rpc";

/**
 * A stand-in for the ID platform's RPC (kan/game src/names.ts): names are
 * unique across kan-game.app and cannot change, and registering an ID's
 * current name again is `ok`. Name validation stays TAKO-SEN's; this fake
 * only refuses the empty name.
 */
export function createIdPlatform(ids?: Iterable<string>) {
  const names = new Map<string, string>();
  const known = ids ? new Set(ids) : undefined;
  const platform: IdRpc = {
    async getName(id) {
      return names.get(id) ?? null;
    },
    async registerName(id, name): Promise<RegisterNameResult> {
      if (known && !known.has(id)) return { result: "no_id" };
      if (name === "") return { result: "invalid" };
      const current = names.get(id);
      if (current === name) return { result: "ok", name };
      if (current !== undefined)
        return { result: "already_named", name: current };
      for (const taken of names.values())
        if (taken === name) return { result: "name_taken" };
      names.set(id, name);
      return { result: "ok", name };
    },
  };
  return { platform, names, binding: platform as unknown as Env["ID"] };
}
