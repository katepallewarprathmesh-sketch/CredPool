import { expect } from "chai";
import request from "supertest";
import { Wallet } from "ethers";
import { issueCredential } from "../src/credentials";

describe("Issuer API security and verification", () => {
  it("API-AUTH-1: rejects an unauthenticated revocation before any RPC action", async () => {
    process.env.ISSUER_API_TOKEN = "test-secret";
    const app = require("../src/server").default;
    const response = await request(app).post(`/credentials/0x${"00".repeat(32)}/revoke`);
    expect(response.status).eq(401);
    expect(response.body.error).eq("unauthorized");
  });

  it("VC-VERIFY-1: resolves did:pkh and verifies the JWT signature", async () => {
    const issuer = Wallet.createRandom(),
      holder = Wallet.createRandom();
    const issued = await issueCredential(
      issuer.privateKey,
      holder.address,
      2,
      31337n,
      Wallet.createRandom().address,
      0n,
    );
    const app = require("../src/server").default;
    const response = await request(app).post("/credentials/verify").send({ vcJwt: issued.vcJwt });
    expect(response.status).eq(200);
    expect(response.body.valid).eq(true);
    expect(response.body.issuer).eq(`did:pkh:eip155:31337:${issuer.address.toLowerCase()}`);
  });
});
