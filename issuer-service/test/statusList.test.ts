import { expect } from "chai";
import { rm } from "node:fs/promises";
import { BitstringStatusStore } from "../src/statusList";
import { Wallet } from "ethers";
import { signCredentialJwt } from "../src/credentials";

describe("W3C Bitstring Status List", () => {
  it("STATUS-1: allocates persistent entries and publishes a compressed revocation list", async () => {
    const file = `${process.cwd()}/.data/status-list-test.json`;
    await rm(file, { force: true });
    const store = new BitstringStatusStore(file, "https://issuer.example/status-lists/1");
    const index = await store.reserve();
    const hash = `0x${"12".repeat(32)}`;
    await store.bind(hash, index);
    expect(store.entry(index)).deep.include({ type: "BitstringStatusListEntry", statusListIndex: String(index) });
    expect(await store.revoke(hash)).eq(index);
    const credential: any = await store.credential("did:pkh:eip155:1:0x0000000000000000000000000000000000000001");
    expect(credential.type).includes("BitstringStatusListCredential");
    expect(credential.credentialSubject.encodedList).to.be.a("string").and.not.empty;
    expect((await signCredentialJwt(Wallet.createRandom().privateKey, 1n, credential)).split(".")).length(3);
  });
});
