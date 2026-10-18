// Makes a VAPID key pair for Web Push (src/worker/push.ts), one per
// environment, after vegtab's backend/scripts/generate-vapid-keys.ts.
//
//   node scripts/generate-vapid-keys.ts
//
// The public key goes in wrangler.jsonc (VAPID_PUBLIC_KEY of the
// environment); the private key is a secret:
//   npx wrangler secret put VAPID_PRIVATE_KEY --env <dev|production>
// or, locally, VAPID_PRIVATE_KEY (with VAPID_PUBLIC_KEY) in .dev.vars.
// Do not paste the private key into a chat or a commit.
import { generateVapidKeys } from "./vapid-keys.ts";

const { publicKey, privateKey } = await generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
