import { run, network } from "hardhat";
import { readFile } from "node:fs/promises";

type Deployment = {
  admin: string;
  deployer: string;
  timelock: string | null;
  timelockDelay: string;
  badgeUri: string;
  issuerRegistry: string;
  credentialRegistry: string;
  accessBadge: string;
  token0: string;
  token1: string;
  pool: string;
  lpToken: string;
};

async function verify(address: string, constructorArguments: unknown[] = []) {
  try {
    await run("verify:verify", { address, constructorArguments });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already verified/i.test(message)) console.log(`${address} already verified`);
    else throw error;
  }
}

async function main() {
  const file = `deployments/${network.name}.json`;
  const d: Deployment = JSON.parse(await readFile(file, "utf8"));
  await verify(d.issuerRegistry, [d.deployer]);
  await verify(d.credentialRegistry, [d.issuerRegistry, d.deployer]);
  await verify(d.accessBadge, [d.issuerRegistry, d.credentialRegistry, d.badgeUri]);
  await verify(d.token0, ["Demo USD", "dUSD"]);
  await verify(d.token1, ["Demo EUR", "dEUR"]);
  await verify(d.pool, [d.token0, d.token1, d.accessBadge, d.deployer]);
  await verify(d.lpToken);
  if (d.timelock)
    await verify(d.timelock, [BigInt(d.timelockDelay), [d.admin], [d.admin], d.deployer]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
