import { gzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface State {
  next: number;
  revoked: number[];
  byHash: Record<string, number>;
}

/** Persistent W3C Bitstring Status List for off-chain VC consumers. */
export class BitstringStatusStore {
  private readonly file: string;
  private state: State = { next: 0, revoked: [], byHash: {} };
  private loaded = false;

  constructor(
    file = path.join(process.cwd(), ".data", "status-list.json"),
    readonly publicUrl = process.env.STATUS_LIST_URL || "http://localhost:4000/status-lists/1",
  ) {
    this.file = file;
  }

  private async load() {
    if (this.loaded) return;
    try {
      this.state = JSON.parse(await readFile(this.file, "utf8"));
    } catch {
      /* first run */
    }
    this.loaded = true;
  }

  private async save() {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.state));
  }

  async reserve() {
    await this.load();
    const index = this.state.next++;
    await this.save();
    return index;
  }
  async bind(hash: string, index: number) {
    await this.load();
    this.state.byHash[hash.toLowerCase()] = index;
    await this.save();
  }
  async revoke(hash: string) {
    await this.load();
    const index = this.state.byHash[hash.toLowerCase()];
    if (index === undefined) throw new Error("credential is not in the status list");
    if (!this.state.revoked.includes(index)) this.state.revoked.push(index);
    await this.save();
    return index;
  }

  entry(index: number) {
    return {
      id: `${this.publicUrl}#${index}`,
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: String(index),
      statusListCredential: this.publicUrl,
    };
  }

  async credential(issuer: string) {
    await this.load();
    const size = Math.max(16_384, Math.ceil(this.state.next / 8));
    const bits = Buffer.alloc(size);
    for (const index of this.state.revoked) bits[Math.floor(index / 8)] |= 1 << index % 8;
    return {
      "@context": [
        "https://www.w3.org/2018/credentials/v1",
        "https://www.w3.org/ns/credentials/status/v1",
      ],
      id: this.publicUrl,
      type: ["VerifiableCredential", "BitstringStatusListCredential"],
      issuer,
      issuanceDate: new Date().toISOString(),
      validFrom: new Date().toISOString(),
      credentialSubject: {
        id: `${this.publicUrl}#list`,
        type: "BitstringStatusList",
        statusPurpose: "revocation",
        encodedList: gzipSync(bits).toString("base64url"),
      },
    };
  }
}
