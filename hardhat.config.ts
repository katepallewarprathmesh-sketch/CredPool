import "@nomicfoundation/hardhat-toolbox";
import "solidity-coverage";
import "hardhat-gas-reporter";
import { HardhatUserConfig } from "hardhat/config";
import "dotenv/config";
const config: HardhatUserConfig = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 500 }, viaIR: true } },
  networks: { sepolia: { url: process.env.SEPOLIA_RPC_URL || "", accounts: process.env.DEPLOYER_PK ? [process.env.DEPLOYER_PK] : [] } },
  gasReporter: { enabled: process.env.REPORT_GAS === "true", currency: "USD" },
  etherscan: { apiKey: process.env.ETHERSCAN_API_KEY || "" }
};
export default config;
