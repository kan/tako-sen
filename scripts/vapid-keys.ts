/**
 * A VAPID key pair for Web Push (src/worker/push.ts): the public key raw in
 * base64url, the private key as its JWK `d`, the forms the push library and
 * the browsers take. scripts/generate-vapid-keys.ts prints one; the tests
 * make their own.
 */
export async function generateVapidKeys(): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const publicKey = Buffer.from(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  ).toString("base64url");
  const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (!d) throw new Error("no private key");
  return { publicKey, privateKey: d };
}
