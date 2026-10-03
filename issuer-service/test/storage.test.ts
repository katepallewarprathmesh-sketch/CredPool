import { expect } from "chai";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Wallet, keccak256, toUtf8Bytes } from "ethers";
import { issueCredential, holderDid } from "../src/credentials";
import {
  encryptCredential,
  decryptCredential,
  uploadEncrypted,
  downloadEncrypted,
  PinataStorage,
  LocalContentAddressedStorage,
  HeliaStorage,
} from "../src/storage";

describe("Issuer and encrypted content-addressed storage", () => {
  it("DID-1: supports did:pkh and optional did:ethr identifiers", () => {
    expect(holderDid(11155111n, "0xABC", "pkh")).eq("did:pkh:eip155:11155111:0xabc");
    expect(holderDid(11155111n, "0xABC", "ethr")).eq("did:ethr:11155111:0xabc");
  });

  it("E2E-3: VC is retrievable, holder-decryptable and hash-consistent", async () => {
    const issuer = Wallet.createRandom(),
      holder = Wallet.createRandom();
    const x = await issueCredential(
      issuer.privateKey,
      holder.address,
      2,
      31337n,
      Wallet.createRandom().address,
      0n,
    );
    expect(x.vcJwt.split(".")).length(3);
    const blob = encryptCredential(JSON.stringify(x.vcPayload), "holder-secret"),
      cid = await uploadEncrypted(blob),
      back = await downloadEncrypted(cid);
    expect(decryptCredential(back, "holder-secret")).eq(JSON.stringify(x.vcPayload));
    const canonical = require("canonicalize")(x.vcPayload);
    expect(keccak256(toUtf8Bytes(canonical))).eq(x.credentialHash);
    expect(() => decryptCredential(back, "wrong")).to.throw();
    const tampered = Buffer.from(back);
    tampered[tampered.length - 1] ^= 1;
    expect(() => decryptCredential(tampered, "holder-secret")).to.throw();
  });

  it("IPFS-1: Pinata pins an integrity envelope and verifies downloads", async () => {
    const original = global.fetch,
      calls: string[] = [];
    let stored = new Uint8Array();
    global.fetch = (async (input: any, init?: any) => {
      calls.push(String(input));
      if (String(input).includes("pinFileToIPFS")) {
        expect(init.headers.Authorization).eq("Bearer test-jwt");
        const file = init.body.get("file") as Blob;
        stored = new Uint8Array(await file.arrayBuffer());
        return new Response(
          JSON.stringify({
            IpfsHash: "QmYwAPJzv5CZsnAzt8auVZRnGi2Cph9mC5VJ1sZQnLwR8V",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(stored, { status: 200 });
    }) as any;
    try {
      const adapter = new PinataStorage("test-jwt", "https://example.mypinata.cloud"),
        ciphertext = Buffer.from("ciphertext"),
        cid = await adapter.upload(ciphertext);
      expect(cid).eq("QmYwAPJzv5CZsnAzt8auVZRnGi2Cph9mC5VJ1sZQnLwR8V");
      expect(await adapter.download(cid)).deep.eq(ciphertext);
      expect(calls).deep.eq([
        "https://api.pinata.cloud/pinning/pinFileToIPFS",
        `https://example.mypinata.cloud/ipfs/${cid}`,
      ]);
    } finally {
      global.fetch = original;
    }
  });

  it("runs the offline adapter contract against local and Helia backends", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "credpool-storage-")),
      memory = new Map<string, Uint8Array>(),
      fakeUnixFs = {
        async addBytes(bytes: Uint8Array) {
          const cid = "QmYwAPJzv5CZsnAzt8auVZRnGi2Cph9mC5VJ1sZQnLwR8V";
          memory.set(cid, Uint8Array.from(bytes));
          return { toString: () => cid };
        },
        async *cat() {
          yield memory.values().next().value!;
        },
      };
    for (const adapter of [new LocalContentAddressedStorage(root), new HeliaStorage(fakeUnixFs)]) {
      const value = Buffer.from("holder-controlled ciphertext"),
        cid = await adapter.upload(value);
      expect(await adapter.download(cid)).deep.eq(value);
    }

    const local = new LocalContentAddressedStorage(root),
      cid = await local.upload(Buffer.from("integrity")),
      file = path.join(root, cid),
      damaged = await readFile(file);
    damaged[0] ^= 1;
    await writeFile(file, damaged);
    let integrityError = "";
    try {
      await local.download(cid);
    } catch (error) {
      integrityError = (error as Error).message;
    }
    expect(integrityError).contains("content check");
  });
});
