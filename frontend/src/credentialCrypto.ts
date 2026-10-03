import type { Signer } from "ethers";

async function holderKey(signer: Signer, account: string, chain: bigint, usage: KeyUsage[]) {
  const proof = await signer.signMessage(
    `CredPool credential encryption key\nAccount: ${account.toLowerCase()}\nChain: ${chain}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(proof));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, usage);
}

export async function encryptForHolder(
  signer: Signer,
  payload: unknown,
  account: string,
  chain: bigint,
) {
  const key = await holderKey(signer, account, chain, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain),
  );
  const packed = new Uint8Array(1 + iv.length + encrypted.length);
  packed[0] = 1;
  packed.set(iv, 1);
  packed.set(encrypted, 13);
  return uint8ArrayToBase64(packed);
}

export async function decryptForHolder(
  signer: Signer,
  packed: Uint8Array,
  account: string,
  chain: bigint,
) {
  if (packed[0] !== 1) throw new Error("Unsupported encrypted credential version");
  const key = await holderKey(signer, account, chain, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: packed.slice(1, 13) },
    key,
    packed.slice(13),
  );
  return new TextDecoder().decode(plain);
}

function uint8ArrayToBase64(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}
