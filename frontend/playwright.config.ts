import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  use: { baseURL: "http://127.0.0.1:4173", headless: true },
  webServer: {
    command: "VITE_CHAIN_ID=11155111 VITE_ACCESS_BADGE_ADDRESS=0x1111111111111111111111111111111111111111 VITE_POOL_ADDRESS=0x2222222222222222222222222222222222222222 VITE_TOKEN0_ADDRESS=0x3333333333333333333333333333333333333333 VITE_TOKEN1_ADDRESS=0x4444444444444444444444444444444444444444 VITE_ISSUER_URL=http://issuer.test npm run dev -- --port 4173",
    port: 4173,
    reuseExistingServer: false,
  },
});
