import { ethers, network } from "hardhat";
import { readFile } from "node:fs/promises";

async function main() {
  const file = `deployments/${network.name}.json`,
    deployment = JSON.parse(await readFile(file, "utf8")),
    issuerAddress = process.env.ISSUER_ADDRESS;
  if (!deployment.timelock) throw new Error("deployment has no timelock");
  if (!issuerAddress) throw new Error("ISSUER_ADDRESS is required for issuer registration check");

  const issuerRegistry = await ethers.getContractAt("IssuerRegistry", deployment.issuerRegistry),
    credentialRegistry = await ethers.getContractAt(
      "CredentialRegistry",
      deployment.credentialRegistry,
    ),
    badge = await ethers.getContractAt("AccessBadge", deployment.accessBadge),
    pool = await ethers.getContractAt("GatedPool", deployment.pool),
    timelock = deployment.timelock as string;

  if ((await pool.badge()).toLowerCase() !== deployment.accessBadge.toLowerCase())
    throw new Error("pool badge wiring mismatch");
  if ((await badge.issuerRegistry()).toLowerCase() !== deployment.issuerRegistry.toLowerCase())
    throw new Error("badge issuer registry wiring mismatch");
  if (
    (await badge.credentialRegistry()).toLowerCase() !== deployment.credentialRegistry.toLowerCase()
  )
    throw new Error("badge credential registry wiring mismatch");
  if (
    (await credentialRegistry.issuerRegistry()).toLowerCase() !==
    deployment.issuerRegistry.toLowerCase()
  )
    throw new Error("credential issuer registry wiring mismatch");

  for (const contract of [issuerRegistry, credentialRegistry, badge, pool]) {
    if (!(await contract.hasRole(await contract.DEFAULT_ADMIN_ROLE(), timelock)))
      throw new Error(`timelock is not default admin of ${await contract.getAddress()}`);
    if (!(await contract.hasRole(await contract.ADMIN_ROLE(), timelock)))
      throw new Error(`timelock is not parameter admin of ${await contract.getAddress()}`);
    if (await contract.hasRole(await contract.DEFAULT_ADMIN_ROLE(), deployment.deployer))
      throw new Error(`deployer still controls ${await contract.getAddress()}`);
  }
  if (!(await pool.hasRole(await pool.GUARDIAN_ROLE(), deployment.guardian)))
    throw new Error("pool guardian is not configured");
  if (
    !(await issuerRegistry.hasRole(
      await issuerRegistry.ISSUER_GUARDIAN_ROLE(),
      deployment.guardian,
    ))
  )
    throw new Error("issuer emergency guardian is not configured");
  if (!(await issuerRegistry.isActive(issuerAddress))) throw new Error("issuer is not registered");

  console.log("CredPool post-deploy sanity checks passed", {
    network: network.name,
    timelock,
    guardian: deployment.guardian,
    issuer: issuerAddress,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
