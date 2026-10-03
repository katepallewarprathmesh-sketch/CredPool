import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { hash, sign } from "./helpers/attestation";
describe("AccessBadge", () => {
  async function fixture() {
    const [admin, issuer, user, other] = await ethers.getSigners();
    const ir = await (await ethers.getContractFactory("IssuerRegistry")).deploy(admin.address);
    await ir.addIssuer(issuer.address, "Issuer");
    const cr = await (
      await ethers.getContractFactory("CredentialRegistry")
    ).deploy(await ir.getAddress(), admin.address);
    const badge = await (
      await ethers.getContractFactory("AccessBadge")
    ).deploy(await ir.getAddress(), await cr.getAddress(), "");
    await cr.grantRole(await cr.BADGE_ROLE(), await badge.getAddress());
    const chainId = (await ethers.provider.getNetwork()).chainId;
    async function make(tier = 1, who = user, nonce = 0n, delta = 3600, label = "vc") {
      const att = {
        subject: who.address,
        tier,
        credentialHash: hash(label + nonce + tier),
        expiry: (await time.latest()) + delta,
        nonce,
      };
      return {
        att,
        sig: await sign(issuer, await badge.getAddress(), chainId, att),
      };
    }
    return { admin, issuer, user, other, ir, cr, badge, chainId, make };
  }
  it("AB-CLAIM-1: valid attestation mints tier", async () => {
    const { badge, user, make } = await loadFixture(fixture);
    const { att, sig } = await make();
    await expect(badge.claim(att, sig)).to.emit(badge, "BadgeClaimed");
    expect(await badge.balanceOf(user.address, 1)).eq(1);
    expect(await badge.tierOf(user.address)).eq(1);
  });
  it("AB-CLAIM-2: unknown signer reverts InvalidSignature", async () => {
    const { badge, user, other, chainId, make } = await loadFixture(fixture);
    const { att } = await make();
    const sig = await sign(other, await badge.getAddress(), chainId, att);
    await expect(badge.claim(att, sig)).revertedWithCustomError(badge, "InvalidSignature");
  });
  it("AB-CLAIM-3: expired attestation reverts Expired", async () => {
    const { badge, make } = await loadFixture(fixture);
    const { att, sig } = await make(1, undefined, 0n, -1);
    await expect(badge.claim(att, sig)).revertedWithCustomError(badge, "Expired");
  });
  it("AB-CLAIM-4: invalid tier reverts InvalidTier", async () => {
    const { badge, make } = await loadFixture(fixture);
    const { att, sig } = await make(4);
    await expect(badge.claim(att, sig)).revertedWithCustomError(badge, "InvalidTier");
  });
  it("AB-REPLAY-1: reused nonce reverts NonceUsed", async () => {
    const { badge, make } = await loadFixture(fixture);
    const { att, sig } = await make();
    await badge.claim(att, sig);
    const next = await make(2, undefined, 0n, 3600, "next");
    await expect(badge.claim(next.att, next.sig)).revertedWithCustomError(badge, "NonceUsed");
  });
  it("AB-REPLAY-2: signature for another chain or contract fails", async () => {
    const { badge, issuer, other, chainId, make } = await loadFixture(fixture);
    const { att } = await make();
    for (const override of [{ chainId: chainId + 1n }, { verifyingContract: other.address }]) {
      const sig = await sign(issuer, await badge.getAddress(), chainId, att, override);
      await expect(badge.claim(att, sig)).revertedWithCustomError(badge, "InvalidSignature");
    }
  });
  it("AB-SIG-3: malformed/high-s signature reverts", async () => {
    const { badge, make } = await loadFixture(fixture);
    const { att } = await make();
    await expect(badge.claim(att, "0x" + "ff".repeat(65))).reverted;
  });
  it("AB-SOUL-1: holder transfer reverts SoulboundTransfer", async () => {
    const { badge, user, other, make } = await loadFixture(fixture);
    const { att, sig } = await make();
    await badge.claim(att, sig);
    await expect(
      badge.connect(user).safeTransferFrom(user.address, other.address, 1, 1, "0x"),
    ).revertedWithCustomError(badge, "SoulboundTransfer");
  });
  it("AB-UPGRADE-1: tier upgrade burns prior badge", async () => {
    const { badge, user, make } = await loadFixture(fixture);
    let x = await make(1);
    await badge.claim(x.att, x.sig);
    x = await make(2, undefined, 1n, 3600, "pro");
    await badge.claim(x.att, x.sig);
    expect(await badge.balanceOf(user.address, 1)).eq(0);
    expect(await badge.balanceOf(user.address, 2)).eq(1);
  });
  it("AB-EXPIRE-1: expiry invalidates and cleanup burns", async () => {
    const { badge, user, make } = await loadFixture(fixture);
    const x = await make(1, undefined, 0n, 10);
    await badge.claim(x.att, x.sig);
    await time.increase(11);
    expect(await badge.tierOf(user.address)).eq(0);
    await badge.burnExpired(user.address);
    expect(await badge.balanceOf(user.address, 1)).eq(0);
  });
});

describe("AccessBadge hardening branches", () => {
  it("covers valid-badge cleanup rejection and empty cleanup", async () => {
    const [a, i, u, nobody] = await ethers.getSigners();
    const ir = await (await ethers.getContractFactory("IssuerRegistry")).deploy(a.address);
    await ir.addIssuer(i.address, "I");
    const cr = await (
        await ethers.getContractFactory("CredentialRegistry")
      ).deploy(await ir.getAddress(), a.address),
      b = await (
        await ethers.getContractFactory("AccessBadge")
      ).deploy(await ir.getAddress(), await cr.getAddress(), "");
    await cr.grantRole(await cr.BADGE_ROLE(), await b.getAddress());
    const att = {
        subject: u.address,
        tier: 3,
        credentialHash: hash("valid"),
        expiry: (await time.latest()) + 100,
        nonce: 0n,
      },
      chain = (await ethers.provider.getNetwork()).chainId;
    await b.claim(att, await sign(i, await b.getAddress(), chain, att));
    await expect(b.burnExpired(u.address)).revertedWithCustomError(b, "CredentialStillValid");
    await expect(b.burnExpired(nobody.address)).not.reverted;
    expect(await b.hasValidTier(u.address, 3)).true;
    expect(await b.hasValidTier(u.address, 4)).false;
  });
});

describe("Remaining badge branches", () => {
  it("rejects tier zero", async () => {
    const [a, i, u] = await ethers.getSigners(),
      ir = await (await ethers.getContractFactory("IssuerRegistry")).deploy(a.address);
    await ir.addIssuer(i.address, "i");
    const cr = await (
        await ethers.getContractFactory("CredentialRegistry")
      ).deploy(await ir.getAddress(), a.address),
      b = await (
        await ethers.getContractFactory("AccessBadge")
      ).deploy(await ir.getAddress(), await cr.getAddress(), "");
    const att = {
      subject: u.address,
      tier: 0,
      credentialHash: hash("zero"),
      expiry: (await time.latest()) + 100,
      nonce: 0n,
    };
    await expect(b.claim(att, "0x")).revertedWithCustomError(b, "InvalidTier");
  });
});

describe("EIP-5192 discovery", () => {
  it("AB-5192-1: advertises ERC-165 soulbound support and locked badge classes", async () => {
    const [a] = await ethers.getSigners(),
      ir = await (await ethers.getContractFactory("IssuerRegistry")).deploy(a.address),
      cr = await (
        await ethers.getContractFactory("CredentialRegistry")
      ).deploy(await ir.getAddress(), a.address),
      badge = await (
        await ethers.getContractFactory("AccessBadge")
      ).deploy(await ir.getAddress(), await cr.getAddress(), "https://example.test/");
    expect(await badge.supportsInterface("0x01ffc9a7")).true;
    expect(await badge.supportsInterface("0xd9b67a26")).true;
    expect(await badge.supportsInterface("0xb45a3c0e")).true;
    for (const id of [1, 2, 3]) expect(await badge.locked(id)).true;
    await expect(badge.locked(0)).revertedWithCustomError(badge, "InvalidTier");
    await expect(badge.locked(4)).revertedWithCustomError(badge, "InvalidTier");
    expect(await badge.uri(1)).eq("https://example.test/1.json");
    await expect(badge.setBaseURI("ipfs://tiers/")).to.emit(badge, "BaseURIUpdated");
    expect(await badge.uri(3)).eq("ipfs://tiers/3.json");
    const [, nonAdmin] = await ethers.getSigners();
    await expect(badge.connect(nonAdmin).setBaseURI("evil://")).reverted;
    await expect(badge.uri(0)).revertedWithCustomError(badge, "InvalidTier");
    await expect(badge.uri(4)).revertedWithCustomError(badge, "InvalidTier");
  });
});
