import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

export interface EncryptedStorageAdapter {
  upload(blob: Buffer): Promise<string>;
  download(cid: string): Promise<Buffer>;
}

export class LocalContentAddressedStorage implements EncryptedStorageAdapter {
  constructor(private readonly root = path.join(process.cwd(), ".data", "ipfs")) {}

  async upload(blob: Buffer) {
    const cid = "bafy" + createHash("sha256").update(blob).digest("hex");
    await mkdir(this.root, { recursive: true });
    await writeFile(path.join(this.root, cid), blob);
    return cid;
  }

  async download(cid: string) {
    if (!/^bafy[a-f0-9]{64}$/.test(cid)) throw new Error("invalid local CID");
    return readFile(path.join(this.root, cid));
  }
}

/** Real IPFS persistence through Pinata's pinning API and dedicated/public gateway. */
export class PinataStorage implements EncryptedStorageAdapter {
  constructor(
    private readonly jwt: string,
    private readonly gateway = "https://gateway.pinata.cloud",
  ) {
    if (!jwt) throw new Error("PINATA_JWT is required when STORAGE_ADAPTER=pinata");
  }

  async upload(blob: Buffer) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(blob)]), "credential.vc.enc");
    form.append("pinataMetadata", JSON.stringify({ name: `credpool-${Date.now()}.vc.enc` }));
    const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.jwt}` },
      body: form,
    });
    if (!response.ok) throw new Error(`Pinata upload failed (${response.status}): ${await response.text()}`);
    const result = await response.json() as { IpfsHash?: string };
    if (!result.IpfsHash) throw new Error("Pinata response did not contain IpfsHash");
    return result.IpfsHash;
  }

  async download(cid: string) {
    if (!/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]+)$/i.test(cid)) throw new Error("invalid IPFS CID");
    const base = this.gateway.replace(/\/$/, "");
    const response = await fetch(`${base}/ipfs/${cid}`, {
      headers: process.env.PINATA_GATEWAY_TOKEN
        ? { "x-pinata-gateway-token": process.env.PINATA_GATEWAY_TOKEN }
        : undefined,
    });
    if (!response.ok) throw new Error(`IPFS download failed (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  }
}

export function storageFromEnv(): EncryptedStorageAdapter {
  const adapter = (process.env.STORAGE_ADAPTER || "local").toLowerCase();
  if (adapter === "local") return new LocalContentAddressedStorage();
  if (adapter === "pinata") return new PinataStorage(process.env.PINATA_JWT || "", process.env.PINATA_GATEWAY_URL);
  throw new Error(`Unsupported STORAGE_ADAPTER: ${adapter}`);
}

// Server-side encryption remains available for tests and migration tooling. The
// HTTP issuance flow does not use it: production encryption happens in the
// holder's browser with a wallet-signature-derived key before upload.
export function encryptCredential(plaintext: string, holderSecret: string) {
  const salt = randomBytes(16), iv = randomBytes(12), key = scryptSync(holderSecret, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([salt, iv, cipher.getAuthTag(), body]);
}

export function decryptCredential(blob: Buffer, holderSecret: string) {
  const salt = blob.subarray(0, 16), iv = blob.subarray(16, 28), tag = blob.subarray(28, 44), body = blob.subarray(44);
  const key = scryptSync(holderSecret, salt, 32), decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

export const uploadEncrypted = (blob: Buffer) => storageFromEnv().upload(blob);
export const downloadEncrypted = (cid: string) => storageFromEnv().download(cid);
