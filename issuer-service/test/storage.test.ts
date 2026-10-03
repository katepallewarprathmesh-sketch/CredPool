import { expect } from "chai";
import { Wallet, keccak256, toUtf8Bytes } from "ethers";
import { issueCredential, holderDid } from "../src/credentials";
import {
  encryptCredential,
  decryptCredential,
  uploadEncrypted,
  downloadEncrypted,
  PinataStorage,
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
  });
  it("IPFS-1: Pinata adapter pins ciphertext and retrieves it through a gateway", async () => {
    const original = global.fetch,
      calls: string[] = [];
    global.fetch = (async (input: any, init?: any) => {
      calls.push(String(input));
      if (String(input).includes("pinFileToIPFS")) {
        expect(init.headers.Authorization).eq("Bearer test-jwt");
        return new Response(
          JSON.stringify({
            IpfsHash: "QmYwAPJzv5CZsnAzt8auVZRnGi2Cph9mC5VJ1sZQnLwR8V",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as any;
    try {
      const adapter = new PinataStorage("test-jwt", "https://example.mypinata.cloud");
      const cid = await adapter.upload(Buffer.from("ciphertext"));
      expect(cid).eq("QmYwAPJzv5CZsnAzt8auVZRnGi2Cph9mC5VJ1sZQnLwR8V");
      expect([...(await adapter.download(cid))]).deep.eq([1, 2, 3]);
      expect(calls).deep.eq([
        "https://api.pinata.cloud/pinning/pinFileToIPFS",
        `https://example.mypinata.cloud/ipfs/${cid}`,
      ]);
    } finally {
      global.fetch = original;
    }
  });
});
