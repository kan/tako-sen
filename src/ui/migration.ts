import { shallowRef } from "vue";
import { redeemMigrationToken } from "./auth";
import { PRESS_AGAIN_ONLINE } from "./notice-text";

/**
 * The offer to take over the records of the old URL, rendered by
 * MigrationDialog.vue. A link carrying a migration token switches the device's
 * ID only after the player agrees, so a link from someone else cannot switch
 * it unnoticed (docs/NEXT_PHASE.md「既存の記録の移行」).
 */
export type MigrationOffer =
  | { readonly state: "asking"; readonly token: string }
  | { readonly state: "working" }
  | { readonly state: "done" }
  /** Can be tried again (no connection, a busy platform). */
  | {
      readonly state: "failed";
      readonly token: string;
      readonly message: string;
    }
  /** The token is unknown or expired: closing is all that is left. */
  | { readonly state: "refused"; readonly message: string };

export const migrationOffer = shallowRef<MigrationOffer>();

export function offerMigration(token: string): void {
  migrationOffer.value = { state: "asking", token };
}

export async function acceptMigration(): Promise<void> {
  const offer = migrationOffer.value;
  if (offer?.state !== "asking" && offer?.state !== "failed") return;
  const { token } = offer;
  migrationOffer.value = { state: "working" };
  const result = await redeemMigrationToken(token);
  migrationOffer.value = result.ok
    ? { state: "done" }
    : result.reason === "invalid"
      ? // Sending the same token again cannot succeed.
        {
          state: "refused",
          message:
            "このリンクは使えません。期限が切れているか、正しくありません。以前の TAKO-SEN でログインし直して、案内のリンクからもう一度開いてください。",
        }
      : {
          state: "failed",
          token,
          message:
            result.reason === "rate_limited"
              ? "入力が多すぎます。1分ほど待ってから、もう一度押してください。"
              : result.reason === "offline"
                ? PRESS_AGAIN_ONLINE
                : "引き継げません。少し待ってから、もう一度押してください。",
        };
}

export function closeMigration(): void {
  if (migrationOffer.value?.state !== "working")
    migrationOffer.value = undefined;
}
