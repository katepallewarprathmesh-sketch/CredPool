import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

export interface EncryptedStorageAdapter {
  upload(blob: Buffer): Promise<string>;
  download(cid: string): Promise<Buffer>;
}

const ENVELOPE_MAGIC = Buffer.from("CP01");

/** Adds an authenticated content digest outside the already-encrypted payload. */
function envelope(blob: Buffer) {
  return Buffer.concat([ENVELOPE_MAGIC, createHash("sha256").update(blob).digest(), blob]);
}

function openEnvelope(value: Buffer) {
  if (value.length < 36 || !value.subarray(0, 4).equals(ENVELOPE_MAGIC))
    throw new Error("stored ciphertext envelope is invalid");
  const expected = value.subarray(4, 36),
    blob = value.subarray(36),
    actual = createHash("sha256").update(blob).digest();
  if (!timingSafeEqual(expected, actual)) throw new Error("stored ciphertext failed content check");
  return blob;
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
    const blob = await readFile(path.join(this.root, cid));
    const actual = "bafy" + createHash("sha256").update(blob).digest("hex");
    if (actual !== cid) throw new Error("stored ciphertext failed content check");
    return blob;
  }
}

/** Real IPFS persistence through Pinata's pinning API and dedicated/public gateway. */
export class PinataStorage implements EncryptedStorageAdapter {
  constructor(
    private readonly jwt: string,
    private readonly gateway = "https://gateway.pinata.cloud",
  ) {
    if (!jwt) throw new Error("PINATA_JWT is required when STORAGE_BACKEND=pinata");
  }

  async upload(blob: Buffer) {
    const wrapped = envelope(blob),
      form = new FormData();
    form.append("file", new Blob([new Uint8Array(wrapped)]), "credential.vc.enc");
    form.append("pinataMetadata", JSON.stringify({ name: `credpool-${Date.now()}.vc.enc` }));
    const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.jwt}` },
      body: form,
    });
    if (!response.ok)
      throw new Error(`Pinata upload failed (${response.status}): ${await response.text()}`);
    const result = (await response.json()) as { IpfsHash?: string };
    if (!result.IpfsHash) throw new Error("Pinata response did not contain IpfsHash");
    return result.IpfsHash;
  }

  async download(cid: string) {
    if (!/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]+)$/i.test(cid))
      throw new Error("invalid IPFS CID");
    const base = this.gateway.replace(/\/$/, "");
    const response = await fetch(`${base}/ipfs/${cid}`, {
      headers: process.env.PINATA_GATEWAY_TOKEN
        ? { "x-pinata-gateway-token": process.env.PINATA_GATEWAY_TOKEN }
        : undefined,
    });
    if (!response.ok) throw new Error(`IPFS download failed (${response.status})`);
    return openEnvelope(Buffer.from(await response.arrayBuffer()));
  }
}

type UnixFsLike = {
  addBytes(bytes: Uint8Array): Promise<{ toString(): string }>;
  cat(cid: unknown): AsyncIterable<Uint8Array>;
};

const nativeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<any>;

/** Embedded IPFS node. An injectable UnixFS surface keeps its contract tests offline. */
export class HeliaStorage implements EncryptedStorageAdapter {
  private fs?: UnixFsLike;

  constructor(fs?: UnixFsLike) {
    this.fs = fs;
  }

  private async unixfs() {
    if (this.fs) return this.fs;
    const [{ createHelia }, { unixfs }] = await Promise.all([
      nativeImport("helia"),
      nativeImport("@helia/unixfs"),
    ]);
    this.fs = unixfs(await createHelia()) as UnixFsLike;
    return this.fs;
  }

  async upload(blob: Buffer) {
    return (await (await this.unixfs()).addBytes(envelope(blob))).toString();
  }

  async download(cid: string) {
    const { CID } = await nativeImport("multiformats/cid"),
      chunks: Buffer[] = [];
    for await (const chunk of (await this.unixfs()).cat(CID.parse(cid)))
      chunks.push(Buffer.from(chunk));
    return openEnvelope(Buffer.concat(chunks));
  }
}

export function storageFromEnv(): EncryptedStorageAdapter {
  // STORAGE_ADAPTER remains a backward-compatible alias for v1.1 deployments.
  const backend = (
    process.env.STORAGE_BACKEND ||
    process.env.STORAGE_ADAPTER ||
    "local"
  ).toLowerCase();
  if (backend === "local") return new LocalContentAddressedStorage();
  if (backend === "pinata")
    return new PinataStorage(process.env.PINATA_JWT || "", process.env.PINATA_GATEWAY_URL);
  if (backend === "helia") return new HeliaStorage();
  throw new Error(`Unsupported STORAGE_BACKEND: ${backend}`);
}

// The holder's browser is the encryption boundary in the HTTP flow. The issuer
// only receives authenticated ciphertext. These helpers remain for offline tests
// and migration tooling; production storage adapters never receive plaintext.
export function encryptCredential(plaintext: string, holderSecret: string) {
  const salt = randomBytes(16),
    iv = randomBytes(12),
    key = scryptSync(holderSecret, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([salt, iv, cipher.getAuthTag(), body]);
}

export function decryptCredential(blob: Buffer, holderSecret: string) {
  const salt = blob.subarray(0, 16),
    iv = blob.subarray(16, 28),
    tag = blob.subarray(28, 44),
    body = blob.subarray(44);
  const key = scryptSync(holderSecret, salt, 32),
    decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

export const uploadEncrypted = (blob: Buffer) => storageFromEnv().upload(blob);
export const downloadEncrypted = (cid: string) => storageFromEnv().download(cid);
