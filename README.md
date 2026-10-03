# CredPool — Credential-Gated DeFi Pools

A permissioned constant-product AMM where a W3C Verifiable Credential, a live on-chain credential record, and a soulbound ERC-1155 badge jointly control swaps and liquidity access.

![CredPool swap interface](docs/credpool-dashboard.png)

## Highlights

- `did:pkh:eip155` identity derived from the connected wallet
- JWT VC issuance plus a chain/contract-bound EIP-712 attestation
- Active issuer and credential registries with immediate revocation
- Soulbound Basic, Pro, and Institutional ERC-1155 badges
- Constant-product AMM with a 0.30% configurable fee, slippage/deadline protection, tier limits, locked initial liquidity, pause, `SafeERC20`, and reentrancy protection
- AES-256-GCM encrypted, content-addressed VC storage (local IPFS-compatible adapter for deterministic development)
- React/Vite frontend for verification, swaps, liquidity, and credential history
- Requirement-named contract and end-to-end tests

## Architecture

```text
React + ethers ── request ──> Issuer service ── JWT VC + EIP-712 signature
      │                              │
      │ encrypted VC                 │ issuer key from environment
      ▼                              ▼
content-addressed store       AccessBadge (ERC-1155)
                                      │
                              CredentialRegistry ── IssuerRegistry
                                      │ live validity
                                      ▼
                           GatedPool AMM ── GatedLP ERC-20
```

## Prerequisites

- Node.js 20+
- npm 10+
- A browser wallet for frontend use

## Quick start

```bash
cp .env.example .env
npm install
npm test
npm run test:issuer
npm run demo
```

`npm run demo` deploys every contract to an ephemeral local Hardhat chain, registers a demo issuer, claims a Pro badge, mints demo assets, and seeds liquidity in one command.

### Persistent local environment

Terminal 1:

```bash
npx hardhat node
```

Terminal 2:

```bash
npx hardhat run scripts/deploy.ts --network localhost
```

Copy the resulting addresses into `.env` and `frontend/.env`, set an issuer key that corresponds to an issuer registered by the admin, then run:

```bash
npm run issuer
npm run frontend
```

The mock KYC passcode used by the UI is `DEMO-PASS`. It is intentionally deterministic and is not real KYC.

## Commands

| Command | Purpose |
|---|---|
| `npm test` | Contract and on-chain integration suite |
| `npm run test:issuer` | VC issuance/encryption/storage E2E test |
| `npm run coverage` | Solidity coverage report |
| `npm run gas` | Contract gas report |
| `npm run demo` | Deploy and seed an ephemeral local demo |
| `npm run deploy -- --network sepolia` | Deploy to Sepolia when environment credentials are supplied |
| `npm run verify:sepolia` | Verify a recorded Sepolia deployment on Etherscan |
| `npm --prefix frontend run build` | Type-check and build the frontend |

## Access policy

### Minimum credential tier by operation

| Operation | Minimum tier |
|---|---:|
| Swap | Basic (1) |
| Add liquidity | Pro (2) |
| Remove liquidity | Pro (2) |

### Default swap limit by credential tier

| Credential tier | Maximum swap per transaction |
|---|---:|
| Basic (1) | 1,000 token0-equivalent |
| Pro (2) | 50,000 token0-equivalent |
| Institutional (3) | Unlimited |

LP shares are transferable, but redemption is always subject to a live Pro-or-higher credential. While paused, swaps and deposits stop; verified withdrawals remain available.

## Credential privacy

Only a credential hash and non-personal access metadata are put on-chain. The service canonicalizes the VC payload before hashing and encrypts the payload with AES-256-GCM before storage. The included storage adapter is local and content-addressed so tests do not rely on a third party. Replace `issuer-service/src/storage.ts` with Pinata/Helia in hosted deployments while preserving its encrypt-before-upload boundary.

## Test status

- 42 Hardhat tests, including every acceptance ID in the specification
- Issuer/encrypted-storage E2E test
- 100% Solidity statements and lines; **90.23% branch coverage**
- Measured pool swap: **110,225 gas average** (110,017 minimum / 110,593 maximum), below the 130k target
- Frontend production build passes
- Local one-command demo passes

See [`docs/SECURITY.md`](docs/SECURITY.md), [`docs/GAS.md`](docs/GAS.md), and the normative [`docs/SPEC.md`](docs/SPEC.md).

## Sepolia

No private key, RPC endpoint, or Etherscan API key is committed. Set `SEPOLIA_RPC_URL`, `DEPLOYER_PK`, and `ETHERSCAN_API_KEY`, run the Sepolia deployment, then run `npm run verify:sepolia`. The deployment command automatically records addresses under `deployments/sepolia.json`. No production/mainnet use is intended.

## License

MIT
