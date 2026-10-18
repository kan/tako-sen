import { shallowRef } from "vue";
import { redeemMigrationToken, redeemTransferCode, type Redeem } from "./auth";
import { redeemRetryText } from "./notice-text";

/**
 * An offer to switch this device's ID, made by a link and rendered by
 * MigrationDialog.vue: the old URL's migration token takes its records over
 * (docs/NEXT_PHASE.md「既存の記録の移行」), and another device's QR code
 * carries a transfer code. The ID switches only after the player agrees, so a
 * link from someone else cannot switch it unnoticed.
 */
export type SwitchKind = "migration" | "transfer";

export type MigrationOffer =
  | {
      readonly state: "asking";
      readonly kind: SwitchKind;
      readonly secret: string;
    }
  | { readonly state: "working"; readonly kind: SwitchKind }
  | { readonly state: "done"; readonly kind: SwitchKind }
  /** Can be tried again (no connection, a busy platform). */
  | {
      readonly state: "failed";
      readonly kind: SwitchKind;
      readonly secret: string;
      readonly message: string;
    }
  /** The secret is unknown, used or expired: closing is all that is left. */
  | {
      readonly state: "refused";
      readonly kind: SwitchKind;
      readonly message: string;
    };

export const migrationOffer = shallowRef<MigrationOffer>();

// A switch under way is not replaced: its answer would land on the new
// offer. The new link can be opened again once it is done.
function offer(kind: SwitchKind, secret: string): void {
  if (migrationOffer.value?.state === "working") return;
  migrationOffer.value = { state: "asking", kind, secret };
}

export function offerMigration(token: string): void {
  offer("migration", token);
}

export function offerTransfer(code: string): void {
  offer("transfer", code);
}

const REDEEM: Record<SwitchKind, (secret: string) => Promise<Redeem>> = {
  migration: redeemMigrationToken,
  transfer: redeemTransferCode,
};

const REFUSED: Record<SwitchKind, string> = {
  migration:
    "このリンクは使えません。期限が切れているか、正しくありません。以前の TAKO-SEN でログインし直して、案内のリンクからもう一度開いてください。",
  transfer:
    "この QR コードは使えません。期限（発行から10分）が切れたか、すでに使われたか、正しく読み取れていません。発行した端末で、新しい引き継ぎコードを発行してください。",
};

export async function acceptMigration(): Promise<void> {
  const offer = migrationOffer.value;
  if (offer?.state !== "asking" && offer?.state !== "failed") return;
  const { kind, secret } = offer;
  migrationOffer.value = { state: "working", kind };
  const result = await REDEEM[kind](secret);
  migrationOffer.value = result.ok
    ? { state: "done", kind }
    : result.reason === "invalid"
      ? // Sending the same secret again cannot succeed.
        { state: "refused", kind, message: REFUSED[kind] }
      : {
          state: "failed",
          kind,
          secret,
          message: redeemRetryText(result.reason),
        };
}

export function closeMigration(): void {
  if (migrationOffer.value?.state !== "working")
    migrationOffer.value = undefined;
}
