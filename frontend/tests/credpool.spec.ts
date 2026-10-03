import { test, expect } from "@playwright/test";

const account = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const txHash = `0x${"12".repeat(32)}`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ account, txHash }) => {
      let tier = 1n;
      (window as any).ethereum = {
        on() {},
        removeListener() {},
        async request({ method, params }: any) {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
          if (method === "eth_chainId") return "0xaa36a7";
          if (method === "personal_sign" || method === "eth_signTypedData_v4")
            return `0x${"11".repeat(64)}1b`;
          if (method === "eth_blockNumber") return "0x10";
          if (method === "eth_estimateGas") return "0x30d40";
          if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas")
            return "0x3b9aca00";
          if (method === "eth_getBlockByNumber")
            return {
              number: "0x10",
              hash: `0x${"ab".repeat(32)}`,
              timestamp: "0x65000000",
              gasLimit: "0x1c9c380",
              gasUsed: "0x0",
              baseFeePerGas: "0x3b9aca00",
              parentHash: `0x${"cd".repeat(32)}`,
              nonce: "0x0000000000000000",
              difficulty: "0x0",
              extraData: "0x",
              transactions: [],
            };
          if (method === "eth_call") {
            const data = String(params?.[0]?.data || "");
            if (data.startsWith("0xc8f74bb8")) return `0x${tier.toString(16).padStart(64, "0")}`;
            if (data.startsWith("0x06fdde03"))
              return `0x${32n.toString(16).padStart(64, "0")}${5n.toString(16).padStart(64, "0")}5553442041${"0".repeat(54)}`;
            if (data.startsWith("0x7ecebe00")) return `0x${"0".repeat(64)}`;
            return `0x${(10n ** 18n).toString(16).padStart(64, "0")}`;
          }
          if (method === "eth_sendTransaction") {
            tier = 1n;
            return txHash;
          }
          if (method === "eth_getTransactionByHash")
            return {
              hash: txHash,
              blockHash: `0x${"ab".repeat(32)}`,
              blockNumber: "0x10",
              index: "0x0",
              transactionIndex: "0x0",
              from: account,
              to: "0x2222222222222222222222222222222222222222",
              nonce: "0x0",
              gas: "0x30d40",
              gasPrice: "0x3b9aca00",
              input: "0x",
              value: "0x0",
              type: "0x2",
              chainId: "0xaa36a7",
              v: "0x1",
              r: `0x${"01".repeat(32)}`,
              s: `0x${"02".repeat(32)}`,
            };
          if (method === "eth_getTransactionReceipt")
            return {
              transactionHash: txHash,
              blockHash: `0x${"ab".repeat(32)}`,
              blockNumber: "0x10",
              index: "0x0",
              transactionIndex: "0x0",
              from: account,
              to: account,
              cumulativeGasUsed: "0x5208",
              gasUsed: "0x5208",
              contractAddress: null,
              logs: [],
              logsBloom: `0x${"00".repeat(256)}`,
              status: "0x1",
              type: "0x2",
              effectiveGasPrice: "0x3b9aca00",
            };
          if (method === "eth_getTransactionCount") return "0x0";
          if (method === "eth_getCode") return "0x1234";
          return null;
        },
      };
    },
    { account, txHash },
  );
  await page.route("http://issuer.test/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/credentials/request"))
      return route.fulfill({
        json: {
          vcJwt: "a.b.c",
          vcPayload: { credentialSubject: { tier: 1 } },
          credentialHash: `0x${"34".repeat(32)}`,
          attestation: {
            subject: account,
            tier: 1,
            credentialHash: `0x${"34".repeat(32)}`,
            expiry: 2_000_000_000,
            nonce: "0",
          },
          signature: `0x${"11".repeat(65)}`,
        },
      });
    if (url.endsWith("/credentials/verify")) return route.fulfill({ json: { valid: true } });
    if (url.endsWith("/storage/upload"))
      return route.fulfill({
        status: 201,
        json: { cid: "bafytestcredential" },
      });
    return route.fulfill({ json: { status: "valid" } });
  });
});

test("connects a wallet and displays its DID", async ({ page }) => {
  await page.goto("/");
  await page.locator("header").getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByText(/did:pkh:eip155:11155111/)).toBeVisible();
  await expect(page.getByText("Basic", { exact: true })).toBeVisible();
});

test("shows credential verification and swap transaction states", async ({ page }) => {
  await page.goto("/");
  await page.locator("header").getByRole("button", { name: "Connect wallet" }).click();
  await page.getByPlaceholder("0.0").first().fill("1");
  await expect(page.getByRole("button", { name: "Review swap" })).toBeEnabled();
  await page.getByRole("button", { name: "Review swap" }).click();
  await expect(page.getByText("Swap confirmed")).toBeVisible();
  await page.getByRole("button", { name: "credentials" }).click();
  await page.getByRole("button", { name: "Upgrade tier" }).click();
  await expect(page.getByText(/Verification complete/)).toBeVisible();
});
