import { expect } from "chai";
import { Wallet } from "ethers";
import { Resolver } from "did-resolver";
import { getResolver as getPkhResolver } from "pkh-did-resolver";
import request from "supertest";
import { IssuerRequestAuthenticator, revocationMessage } from "../src/auth";
import { issueCredential, issuerDid } from "../src/credentials";
import { verifyCredPoolCredential } from "../src/verification";

describe("Issuer request authentication and strict VC verification", () => {
  const resolver = new Resolver(getPkhResolver() as any);

  it("rejects replayed EIP-191 revocation authorization", async () => {
    const wallet = Wallet.createRandom(),
      hash = `0x${"12".repeat(32)}`,
      nonce = "unique-nonce-123",
      timestamp = Math.floor(Date.now() / 1000),
      signature = await wallet.signMessage(revocationMessage(hash, nonce, timestamp)),
      body = { issuer: wallet.address, nonce, timestamp, signature },
      auth = new IssuerRequestAuthenticator();
    expect(await auth.verify(hash, body, async () => true)).eq(wallet.address);
    let message = "";
    try {
      await auth.verify(hash, body, async () => true);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).contains("already used");
  });

  it("rejects tampering, wrong subjects, expiry, and hash mismatches", async () => {
    const issuer = Wallet.createRandom(),
      holder = Wallet.createRandom(),
      badge = Wallet.createRandom().address,
      issued = await issueCredential(issuer.privateKey, holder.address, 2, 31337n, badge, 0n),
      expected = {
        issuerDid: issuerDid(31337n, issuer.address),
        holder: holder.address,
        chainId: 31337n,
      };
    await verifyCredPoolCredential(issued.vcJwt, resolver, {
      ...expected,
      credentialHash: issued.credentialHash,
    });

    const failures: Array<Promise<unknown>> = [
      verifyCredPoolCredential(`${issued.vcJwt.slice(0, -1)}x`, resolver, expected),
      verifyCredPoolCredential(issued.vcJwt, resolver, {
        ...expected,
        holder: Wallet.createRandom().address,
      }),
      verifyCredPoolCredential(issued.vcJwt, resolver, {
        ...expected,
        now: Number(issued.attestation.expiry) + 1,
      }),
      verifyCredPoolCredential(issued.vcJwt, resolver, {
        ...expected,
        credentialHash: `0x${"34".repeat(32)}`,
      }),
    ];
    for (const failure of failures) {
      let failed = false;
      try {
        await failure;
      } catch {
        failed = true;
      }
      expect(failed).true;
    }
  });

  it("rate-limits repeated issuance attempts", async () => {
    const app = require("../src/server").default,
      body = {
        address: Wallet.createRandom().address,
        tier: 1,
        nonce: "0",
        kycPayload: { passcode: "wrong" },
      };
    let limited = false;
    for (let i = 0; i < 35; i++) {
      const response = await request(app).post("/credentials/request").send(body);
      if (response.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).true;
  });
});
