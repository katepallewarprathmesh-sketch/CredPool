import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { deploy } from "../scripts/deploy";

describe("Timelocked administration and emergency guardians", () => {
  it("removes deployer roles, delays parameters, and keeps emergency actions immediate", async () => {
    const [deployer, admin, guardian, issuer] = await ethers.getSigners();
    const prior = {
      ADMIN: process.env.ADMIN,
      ADMIN_MULTISIG: process.env.ADMIN_MULTISIG,
      GUARDIAN_ADDRESS: process.env.GUARDIAN_ADDRESS,
      TIMELOCK_DELAY: process.env.TIMELOCK_DELAY,
    };
    process.env.ADMIN = admin.address;
    delete process.env.ADMIN_MULTISIG;
    process.env.GUARDIAN_ADDRESS = guardian.address;
    process.env.TIMELOCK_DELAY = "100";
    try {
      const { ir, cr, badge, pool, addresses } = await deploy();
      const timelock = await ethers.getContractAt("CredPoolTimelock", addresses.timelock!);
      for (const controlled of [ir, cr, badge, pool]) {
        expect(await controlled.hasRole(await controlled.DEFAULT_ADMIN_ROLE(), deployer.address))
          .false;
        expect(await controlled.hasRole(await controlled.ADMIN_ROLE(), deployer.address)).false;
      }
      expect(await pool.hasRole(await pool.GUARDIAN_ROLE(), guardian.address)).true;
      expect(await ir.hasRole(await ir.ISSUER_GUARDIAN_ROLE(), guardian.address)).true;

      const zero = ethers.ZeroHash;
      let salt = ethers.id("fee-change"),
        data = pool.interface.encodeFunctionData("setFee", [25]);
      await timelock.connect(admin).schedule(await pool.getAddress(), 0, data, zero, salt, 100);
      await expect(timelock.connect(admin).execute(await pool.getAddress(), 0, data, zero, salt))
        .reverted;
      await time.increase(100);
      await timelock.connect(admin).execute(await pool.getAddress(), 0, data, zero, salt);
      expect(await pool.feeBps()).eq(25);

      await pool.connect(guardian).pause();
      expect(await pool.paused()).true;
      await pool.connect(guardian).unpause();

      salt = ethers.id("add-issuer");
      data = ir.interface.encodeFunctionData("addIssuer", [issuer.address, "Emergency test"]);
      await timelock.connect(admin).schedule(await ir.getAddress(), 0, data, zero, salt, 100);
      await time.increase(100);
      await timelock.connect(admin).execute(await ir.getAddress(), 0, data, zero, salt);
      expect(await ir.isActive(issuer.address)).true;
      await ir.connect(guardian).removeIssuer(issuer.address);
      expect(await ir.isActive(issuer.address)).false;
    } finally {
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
