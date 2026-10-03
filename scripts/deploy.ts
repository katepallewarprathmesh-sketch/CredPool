import { ethers, network } from "hardhat";
import { mkdir, writeFile } from "node:fs/promises";

async function mined(tx: Promise<any>) {
  await (await tx).wait();
}

export async function deploy() {
  const [deployer] = await ethers.getSigners();
  const isPublic = network.name === "sepolia";
  const multisig = process.env.ADMIN_MULTISIG;
  if (isPublic && !multisig) throw new Error("ADMIN_MULTISIG is required for public deployments");

  const Issuers = await ethers.getContractFactory("IssuerRegistry");
  const ir = await Issuers.deploy(deployer.address);
  await ir.waitForDeployment();
  const Credentials = await ethers.getContractFactory("CredentialRegistry");
  const cr = await Credentials.deploy(await ir.getAddress(), deployer.address);
  await cr.waitForDeployment();
  const badgeUri =
    process.env.BADGE_URI ||
    "https://raw.githubusercontent.com/katepallewarprathmesh-sketch/CredPool/main/frontend/public/metadata/{id}.json";
  const Badge = await ethers.getContractFactory("AccessBadge");
  const badge = await Badge.deploy(await ir.getAddress(), await cr.getAddress(), badgeUri);
  await badge.waitForDeployment();
  await mined(cr.grantRole(await cr.BADGE_ROLE(), await badge.getAddress()));

  const Token = await ethers.getContractFactory("MockERC20");
  const token0 = await Token.deploy("Demo USD", "dUSD");
  const token1 = await Token.deploy("Demo EUR", "dEUR");
  await Promise.all([token0.waitForDeployment(), token1.waitForDeployment()]);
  const Pool = await ethers.getContractFactory("GatedPool");
  const pool = await Pool.deploy(
    await token0.getAddress(),
    await token1.getAddress(),
    await badge.getAddress(),
    deployer.address,
  );
  await pool.waitForDeployment();

  let timelockAddress: string | null = null;
  const delay = BigInt(process.env.TIMELOCK_DELAY || (isPublic ? "86400" : "0"));
  if (multisig) {
    const Timelock = await ethers.getContractFactory("CredPoolTimelock");
    const timelock = await Timelock.deploy(delay, [multisig], [multisig], deployer.address);
    await timelock.waitForDeployment();
    timelockAddress = await timelock.getAddress();

    for (const controlled of [ir, cr, pool]) {
      await mined(controlled.grantRole(await controlled.DEFAULT_ADMIN_ROLE(), timelockAddress));
      await mined(controlled.grantRole(await controlled.ADMIN_ROLE(), timelockAddress));
      await mined(controlled.renounceRole(await controlled.ADMIN_ROLE(), deployer.address));
      await mined(controlled.renounceRole(await controlled.DEFAULT_ADMIN_ROLE(), deployer.address));
    }
    await mined(timelock.renounceRole(await timelock.DEFAULT_ADMIN_ROLE(), deployer.address));
  }

  const addresses = {
    network: network.name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    deployer: deployer.address,
    admin: multisig || deployer.address,
    timelock: timelockAddress,
    timelockDelay: delay.toString(),
    badgeUri,
    issuerRegistry: await ir.getAddress(),
    credentialRegistry: await cr.getAddress(),
    accessBadge: await badge.getAddress(),
    token0: await token0.getAddress(),
    token1: await token1.getAddress(),
    pool: await pool.getAddress(),
    lpToken: await pool.lpToken(),
  };
  await mkdir("deployments", { recursive: true });
  await writeFile(`deployments/${network.name}.json`, JSON.stringify(addresses, null, 2));
  console.log(addresses);
  return { admin: deployer, ir, cr, badge, token0, token1, pool, addresses };
}

if (require.main === module)
  deploy().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
