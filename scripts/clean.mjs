import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const common = [
  ".data",
  "artifacts",
  "cache",
  "coverage",
  "coverage.json",
  "out-forge",
  "cache-forge",
  "typechain-types",
  "deployments/hardhat.json",
  "frontend/dist",
  "frontend/playwright-report",
  "frontend/test-results",
  "frontend/tsconfig.tsbuildinfo",
];
const frontendOnly = [
  "frontend/dist",
  "frontend/playwright-report",
  "frontend/test-results",
  "frontend/tsconfig.tsbuildinfo",
];
const mode = process.argv[2];
const targets =
  mode === "frontend"
    ? frontendOnly
    : mode === "all"
      ? [...common, "node_modules", "frontend/node_modules"]
      : common;

await Promise.all(
  targets.map((target) => rm(resolve(root, target), { recursive: true, force: true })),
);
console.log(`Removed ${targets.length} generated workspace paths.`);
