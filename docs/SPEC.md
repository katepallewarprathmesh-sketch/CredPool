# Credential-Gated DeFi Pools: Specification

**Status:** Draft v1.0
**Stack:** Solidity ^0.8.24, Hardhat, OpenZeppelin v5, Ethers.js v6, Node.js/TypeScript, IPFS (Pinata or Helia), did-jwt-vc / Veramo
**Approach:** Spec-driven. Every requirement has an ID, every ID maps to an acceptance test, and no code is written without a requirement it satisfies.

---

## 0. How to use this spec

1. Read sections 1 to 4 (scope, actors, requirements, architecture).
2. Pick the next unchecked task in section 11.
3. Write the failing tests for the requirement IDs the task cites (section 9).
4. Implement until the tests pass.
5. Update the traceability matrix (section 12) and tick the task.

Requirement keywords: **MUST**, **SHOULD**, **MAY** follow RFC 2119.

---

## 1. Problem and scope

Institutions want DeFi liquidity but need to restrict who can trade or provide liquidity. This project builds a permissioned AMM where access depends on a **W3C Verifiable Credential (VC)** issued to a **DID**, anchored on-chain, and represented as a non-transferable **ERC-1155 access badge**.

### In scope
- DID creation (`did:pkh` / `did:ethr`) from an EVM wallet
- Mock KYC issuer service that signs VCs
- On-chain issuer registry, credential registry, soulbound badge, gated constant-product pool
- Encrypted VC storage on IPFS with only hash and metadata exposed
- Web frontend: connect, request credential, view credentials, swap, add/remove liquidity
- Hardhat test suite, gas report, security checklist

### Out of scope (v1)
- Real KYC providers, real fiat or legal compliance
- Concentrated liquidity (future: swap in the CLMM from Project 1)
- Mainnet deployment (testnet only: Sepolia)

### Stretch (v2)
- ZK proof of credential claims (S-1)
- Cross-chain badge mirroring via mock bridge (S-2)

---

## 2. Actors

| Actor | Description |
|---|---|
| **Holder** | End user with a wallet and DID who wants to trade or provide liquidity |
| **Issuer** | Trusted entity (mock KYC provider) that signs credentials |
| **Admin** | Owner or governance multisig that manages the issuer registry and pool parameters |
| **Verifier** | The smart contracts that check credentials on-chain |

---

## 3. Functional requirements

### 3.1 Identity and credentials (off-chain)

| ID | Requirement |
|---|---|
| FR-ID-1 | The system MUST derive a DID from the holder's wallet address (`did:pkh:eip155:<chainId>:<address>`). |
| FR-ID-2 | The issuer service MUST issue a VC (JWT format) whose `credentialSubject.id` is the holder's DID. |
| FR-ID-3 | A VC MUST contain: `type`, `issuer` DID, `issuanceDate`, `expirationDate`, and `credentialSubject.tier` (1, 2, or 3). |
| FR-ID-4 | The issuer service MUST sign an EIP-712 **Attestation** alongside the VC (see 5.2) so the contract can verify it without parsing JWTs. |
| FR-ID-5 | The VC MUST be encrypted client-side (or by the issuer with the holder's key) before IPFS upload. Only the CID and the credential hash are public. |
| FR-ID-6 | The holder MUST be able to list, view, and re-download their credentials from the frontend. |

### 3.2 Issuer registry

| ID | Requirement |
|---|---|
| FR-IR-1 | Admin MUST be able to add and remove trusted issuers. |
| FR-IR-2 | Issuer entries MUST store: signer address, name, `active` flag, `addedAt`. |
| FR-IR-3 | Removing an issuer MUST invalidate all credentials that issuer produced (checked at verify time). |
| FR-IR-4 | Events MUST be emitted for add, remove, and update. |

### 3.3 Credential registry

| ID | Requirement |
|---|---|
| FR-CR-1 | A credential MUST be anchored by its `credentialHash` (keccak256 of the canonical VC payload). |
| FR-CR-2 | Anchoring MUST store: `issuer`, `subject`, `tier`, `expiry`, `revoked`. |
| FR-CR-3 | The issuer MUST be able to revoke a credential it issued. Admin MAY revoke any credential. |
| FR-CR-4 | `isValid(hash)` MUST return true only if: anchored, not revoked, not expired, issuer still active. |
| FR-CR-5 | A hash MUST NOT be anchorable twice. |
| FR-CR-6 | Each subject MAY hold one active credential at a time; a new one replaces the old one. |

### 3.4 Access badge (ERC-1155)

| ID | Requirement |
|---|---|
| FR-AB-1 | Token IDs: `1 = Basic`, `2 = Pro`, `3 = Institutional`. |
| FR-AB-2 | The holder MUST claim a badge by submitting an issuer-signed attestation. The contract verifies the signature, anchors the credential, and mints the badge. |
| FR-AB-3 | Badges MUST be **soulbound**: transfers between non-zero addresses MUST revert. Mint and burn are allowed. |
| FR-AB-4 | Revoking or expiring a credential MUST make the badge unusable at the pool, and anyone MAY call `burnExpired(account)` to clean it up. |
| FR-AB-5 | A holder MUST hold at most one tier at a time. Claiming a new tier burns the old badge. |
| FR-AB-6 | Attestations MUST be replay-protected with a per-subject nonce and bound to `chainId` and the contract address (EIP-712 domain). |

### 3.5 Gated pool

| ID | Requirement |
|---|---|
| FR-GP-1 | The pool MUST implement a constant-product AMM (`x * y = k`) for one ERC-20 pair. |
| FR-GP-2 | Swap fee MUST default to 0.30% and be configurable by admin within [0.01%, 1%]. |
| FR-GP-3 | `swap`, `addLiquidity`, `removeLiquidity` MUST all be guarded by `onlyVerified(minTier)`. |
| FR-GP-4 | Minimum tier: swap requires **Basic+**, add/remove liquidity requires **Pro+**. |
| FR-GP-5 | Per-transaction swap limit by tier (configurable): Basic 1,000, Pro 50,000, Institutional unlimited (in token0-equivalent units). |
| FR-GP-6 | LP shares MUST be an internal ERC-20 (`GatedLP`). Transfers of LP tokens MAY be allowed, but `removeLiquidity` still requires a valid badge. |
| FR-GP-7 | `swap` MUST take `minAmountOut` and `deadline`, and revert on violation. |
| FR-GP-8 | The first liquidity provider MUST lock `MINIMUM_LIQUIDITY` (1000 wei of shares) permanently. |
| FR-GP-9 | Admin MUST be able to pause and unpause the pool. Withdrawals SHOULD remain possible for verified users while paused (emergency exit). |

### 3.6 Frontend

| ID | Requirement |
|---|---|
| FR-UI-1 | Connect wallet (MetaMask / WalletConnect) and show DID and network. |
| FR-UI-2 | "Get verified" flow: request VC, sign, claim badge, show tier and expiry. |
| FR-UI-3 | Swap form with quote, price impact, slippage setting, and disabled state with explanation when unverified. |
| FR-UI-4 | Liquidity form (add/remove) shown only to Pro+. |
| FR-UI-5 | Credentials page: status (valid / expired / revoked), IPFS CID, revoke-status polling. |

---

## 4. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | **Security:** no reentrancy, checks-effects-interactions, `SafeERC20`, custom errors, role-based access via `AccessControl`. |
| NFR-2 | **Test coverage:** at least 95% line and 90% branch coverage on contracts. |
| NFR-3 | **Gas:** `swap` SHOULD cost under 130k gas including the credential check; report published via `hardhat-gas-reporter`. |
| NFR-4 | **Privacy:** no personal data on-chain or in plaintext on IPFS. |
| NFR-5 | **Upgradeability:** v1 is non-upgradeable; parameters are changed through admin setters only. |
| NFR-6 | **Static analysis:** Slither runs clean of high/medium findings (or each is documented as a false positive). |
| NFR-7 | **Reproducibility:** one command to deploy locally and seed demo data (`npm run demo`). |

---

## 5. Architecture

### 5.1 Components

```
┌──────────────┐   1. request VC    ┌────────────────────┐
│   Frontend   │ ─────────────────► │  Issuer Service     │
│ (Ethers.js)  │ ◄───────────────── │  (Node/TS, Veramo)  │
└──────┬───────┘  VC + EIP-712 sig  └────────┬───────────┘
       │ 2. upload encrypted VC               │ signs with issuer key
       ▼                                      │
   ┌───────┐                                  │
   │ IPFS  │                                  │
   └───────┘                                  │
       │ 3. claim(attestation, sig)           │
       ▼                                      ▼
┌─────────────────────────── EVM ──────────────────────────────┐
│  AccessBadge (ERC-1155) ──► CredentialRegistry ──► IssuerRegistry │
│          ▲                                                    │
│          │ balanceOf + isValid                                │
│      GatedPool (AMM) ◄── tokens (ERC-20 A/B)                  │
└───────────────────────────────────────────────────────────────┘
```

### 5.2 EIP-712 Attestation

```
Domain: { name: "GatedAccess", version: "1", chainId, verifyingContract: AccessBadge }

Attestation {
  address subject;
  uint8   tier;
  bytes32 credentialHash;
  uint64  expiry;
  uint256 nonce;
}
```

The issuer signs the attestation. `AccessBadge.claim` recovers the signer, checks `IssuerRegistry.isActive(signer)`, verifies nonce and expiry, anchors in `CredentialRegistry`, burns any old badge, and mints the new tier.

### 5.3 Repository layout

```
gated-defi/
├── contracts/
│   ├── interfaces/
│   │   ├── IIssuerRegistry.sol
│   │   ├── ICredentialRegistry.sol
│   │   └── IAccessBadge.sol
│   ├── IssuerRegistry.sol
│   ├── CredentialRegistry.sol
│   ├── AccessBadge.sol
│   ├── GatedPool.sol
│   ├── GatedLP.sol
│   └── mocks/MockERC20.sol
├── test/
│   ├── IssuerRegistry.test.ts
│   ├── CredentialRegistry.test.ts
│   ├── AccessBadge.test.ts
│   ├── GatedPool.test.ts
│   ├── integration.test.ts
│   └── helpers/attestation.ts
├── scripts/            # deploy.ts, seed.ts
├── issuer-service/     # Express + Veramo / did-jwt-vc
├── frontend/           # Vite + React + Ethers v6
├── docs/               # SPEC.md, SECURITY.md, GAS.md
└── hardhat.config.ts
```

---

## 6. Contract interfaces (normative)

### 6.1 IssuerRegistry

```solidity
interface IIssuerRegistry {
    struct Issuer { string name; bool active; uint64 addedAt; }

    event IssuerAdded(address indexed signer, string name);
    event IssuerRemoved(address indexed signer);

    function addIssuer(address signer, string calldata name) external;   // ADMIN_ROLE
    function removeIssuer(address signer) external;                      // ADMIN_ROLE
    function isActive(address signer) external view returns (bool);
    function getIssuer(address signer) external view returns (Issuer memory);
}
```

### 6.2 CredentialRegistry

```solidity
interface ICredentialRegistry {
    struct Credential {
        address issuer; address subject; uint8 tier;
        uint64 expiry; bool revoked;
    }

    event CredentialAnchored(bytes32 indexed hash, address indexed subject, address indexed issuer, uint8 tier, uint64 expiry);
    event CredentialRevoked(bytes32 indexed hash, address indexed by);

    function anchor(bytes32 hash, address issuer, address subject, uint8 tier, uint64 expiry) external; // BADGE_ROLE only
    function revoke(bytes32 hash) external;                 // issuer of the credential or ADMIN_ROLE
    function isValid(bytes32 hash) external view returns (bool);
    function activeCredentialOf(address subject) external view returns (bytes32);
    function get(bytes32 hash) external view returns (Credential memory);
}
```

### 6.3 AccessBadge

```solidity
interface IAccessBadge {
    struct Attestation { address subject; uint8 tier; bytes32 credentialHash; uint64 expiry; uint256 nonce; }

    event BadgeClaimed(address indexed subject, uint8 tier, bytes32 credentialHash);

    function claim(Attestation calldata att, bytes calldata signature) external;
    function burnExpired(address account) external;
    function tierOf(address account) external view returns (uint8);       // 0 if none/invalid
    function hasValidTier(address account, uint8 minTier) external view returns (bool);
    function nonces(address subject) external view returns (uint256);
}
```

`tierOf` MUST return 0 when the badge is held but the underlying credential is invalid.

### 6.4 GatedPool

```solidity
interface IGatedPool {
    event Swap(address indexed user, address tokenIn, uint256 amountIn, uint256 amountOut);
    event LiquidityAdded(address indexed user, uint256 amount0, uint256 amount1, uint256 shares);
    event LiquidityRemoved(address indexed user, uint256 amount0, uint256 amount1, uint256 shares);

    function swap(address tokenIn, uint256 amountIn, uint256 minAmountOut, uint256 deadline) external returns (uint256 amountOut);
    function addLiquidity(uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline) external returns (uint256 shares);
    function removeLiquidity(uint256 shares, uint256 amount0Min, uint256 amount1Min, uint256 deadline) external returns (uint256 amount0, uint256 amount1);
    function getAmountOut(address tokenIn, uint256 amountIn) external view returns (uint256);

    function setFee(uint16 feeBps) external;                      // ADMIN_ROLE
    function setTierLimit(uint8 tier, uint256 maxSwap) external;  // ADMIN_ROLE
    function pause() external;  function unpause() external;      // ADMIN_ROLE
}
```

Errors (custom): `NotVerified(uint8 required)`, `Expired()`, `Slippage()`, `LimitExceeded()`, `InsufficientLiquidity()`, `InvalidTier()`, `InvalidSignature()`, `NonceUsed()`, `AlreadyAnchored()`, `SoulboundTransfer()`.

---

## 7. State machines

### Credential lifecycle
```
(none) --claim--> ACTIVE --revoke--> REVOKED
                    │
                    ├--time passes--> EXPIRED
                    └--issuer removed--> INVALID (derived)
```

### Holder access
```
UNVERIFIED --claim(tier=1)--> BASIC --claim(tier=2)--> PRO --claim(tier=3)--> INSTITUTIONAL
     ▲                           │ (any state) revoke / expire / issuer removed
     └───────────────────────────┘
```

---

## 8. Security considerations

| Risk | Mitigation | Test |
|---|---|---|
| Attestation replay (same chain or cross-chain) | EIP-712 domain with chainId + contract; per-subject nonce | AB-REPLAY-1, AB-REPLAY-2 |
| Signature malleability | OpenZeppelin `ECDSA` (rejects high-s) | AB-SIG-3 |
| Compromised issuer | Admin removes issuer; all its credentials become invalid at verify time | IR-REMOVE-1, GP-ISSUER-1 |
| Sybil / badge transfer | Soulbound ERC-1155 | AB-SOUL-1 |
| Stale badge after revocation | Pool calls `hasValidTier`, which checks the registry live | GP-REVOKE-1 |
| First-depositor share inflation | `MINIMUM_LIQUIDITY` lock | GP-LP-3 |
| Reentrancy (ERC-777-like tokens) | `ReentrancyGuard`, CEI ordering | GP-REENT-1 |
| Price manipulation / sandwich | `minAmountOut`, `deadline` (no on-chain oracle used) | GP-SLIP-1 |
| Fee-on-transfer tokens | Compute amounts from balance deltas, or explicitly reject | GP-FOT-1 |
| Admin key risk | `AccessControl` roles; use multisig in deployment script | n/a |
| Privacy leak | No PII in VC `credentialSubject` beyond tier; encrypted on IPFS | manual review |

A `docs/SECURITY.md` MUST list Slither output, manual review notes, and known limitations.

---

## 9. Acceptance tests

Each ID below MUST exist as a named test (`it("AB-SOUL-1: ...")`).

### IssuerRegistry
- **IR-ADD-1** Admin adds an issuer; `isActive` is true; event emitted.
- **IR-ADD-2** Non-admin add reverts.
- **IR-REMOVE-1** Removing an issuer makes `isActive` false and invalidates its credentials.

### CredentialRegistry
- **CR-ANCHOR-1** Only `BADGE_ROLE` can anchor.
- **CR-ANCHOR-2** Anchoring the same hash twice reverts `AlreadyAnchored`.
- **CR-VALID-1** `isValid` is true for fresh credentials; false after expiry (time travel); false after revoke; false after issuer removal.
- **CR-REVOKE-1** The issuing signer can revoke; a random account cannot; admin can.
- **CR-REPLACE-1** A new credential for the same subject replaces `activeCredentialOf`.

### AccessBadge
- **AB-CLAIM-1** Valid attestation mints the correct tier to `subject`.
- **AB-CLAIM-2** Attestation from a non-registered signer reverts `InvalidSignature`.
- **AB-CLAIM-3** Expired attestation reverts `Expired`.
- **AB-CLAIM-4** Tier outside 1..3 reverts `InvalidTier`.
- **AB-REPLAY-1** Reusing a nonce reverts `NonceUsed`.
- **AB-REPLAY-2** Attestation signed for another chainId or contract fails.
- **AB-SIG-3** High-s malleated signature reverts.
- **AB-SOUL-1** `safeTransferFrom` between holders reverts `SoulboundTransfer`.
- **AB-UPGRADE-1** Claiming tier 2 after tier 1 burns tier 1 (single tier at a time).
- **AB-EXPIRE-1** After expiry `tierOf` returns 0 and `burnExpired` burns the badge.

### GatedPool
- **GP-ACCESS-1** Unverified address cannot swap or add liquidity.
- **GP-ACCESS-2** Basic can swap but cannot add liquidity.
- **GP-ACCESS-3** Pro and Institutional can do both.
- **GP-LIMIT-1** Basic swap above the limit reverts `LimitExceeded`; Institutional is unlimited.
- **GP-REVOKE-1** After revocation, a previously verified user's swap reverts.
- **GP-ISSUER-1** After the issuer is removed, all its holders lose access.
- **GP-LP-1** First deposit mints `sqrt(a*b) - MINIMUM_LIQUIDITY` shares.
- **GP-LP-2** Remove liquidity returns a proportional share; `k` never decreases after swaps (fees accrue).
- **GP-LP-3** First-depositor inflation attack does not steal from the second depositor.
- **GP-SWAP-1** `getAmountOut` matches the executed output exactly.
- **GP-SLIP-1** `minAmountOut` and `deadline` enforced.
- **GP-PAUSE-1** Swaps are blocked while paused; `removeLiquidity` still works.
- **GP-REENT-1** Reentrant token callback cannot drain the pool.
- **GP-FOT-1** Fee-on-transfer token behavior is defined (reject or handle).
- **GP-FUZZ-1** Property: for random swap sequences, `reserve0 * reserve1` is non-decreasing.

### Integration (end-to-end, local chain)
- **E2E-1** Issuer service issues a VC → holder claims badge → holder swaps → issuer revokes → swap fails.
- **E2E-2** Holder upgrades Basic → Pro → can now add liquidity.
- **E2E-3** VC uploaded to IPFS is retrievable, decryptable by the holder, and its hash matches the on-chain `credentialHash`.

---

## 10. Issuer service API

Base URL: `http://localhost:4000`

| Method | Path | Description |
|---|---|---|
| POST | `/credentials/request` | Body `{ address, tier, kycPayload }` (mock). Returns `{ vcJwt, attestation, signature, credentialHash }`. |
| POST | `/credentials/:hash/revoke` | Issuer-authenticated. Sends the on-chain `revoke` transaction. |
| GET | `/credentials/:hash/status` | Returns `valid / expired / revoked` by reading the chain. |
| GET | `/.well-known/did.json` | Issuer DID document. |

Rules:
- The mock KYC check MUST be deterministic (e.g. address allowlist or a passcode) so tests are repeatable.
- The issuer private key MUST be loaded from env (`ISSUER_PK`), never committed.
- `credentialHash = keccak256(canonicalize(vcPayload))` using RFC 8785 JSON canonicalization.

---

## 11. Implementation plan (task breakdown)

Each task lists its inputs (requirements) and its done criteria (tests).

### Phase 0: Setup (Day 1)
- [ ] **T0.1** Init Hardhat (TypeScript), OpenZeppelin v5, gas reporter, solidity-coverage, Slither config. *Done: `npx hardhat test` runs an empty suite.*
- [ ] **T0.2** Add `MockERC20`, EIP-712 test helper (`helpers/attestation.ts`).

### Phase 1: Registries (Days 2-4)
- [ ] **T1.1** `IssuerRegistry` with `AccessControl`. *FR-IR-1..4; tests IR-\**
- [ ] **T1.2** `CredentialRegistry`. *FR-CR-1..6; tests CR-\**

### Phase 2: Badge (Days 5-8)
- [ ] **T2.1** `AccessBadge` ERC-1155 with soulbound `_update` override. *FR-AB-1, 3*
- [ ] **T2.2** EIP-712 `claim` with nonce and signature checks. *FR-AB-2, 5, 6; tests AB-CLAIM, AB-REPLAY, AB-SIG*
- [ ] **T2.3** `tierOf`, `hasValidTier`, `burnExpired`. *FR-AB-4; tests AB-EXPIRE-1*

### Phase 3: Pool (Days 9-14)
- [ ] **T3.1** `GatedLP` + `GatedPool` constant-product core (no gating yet). *FR-GP-1, 2, 6, 7, 8; tests GP-LP, GP-SWAP, GP-SLIP*
- [ ] **T3.2** Add `onlyVerified(minTier)` and tier limits. *FR-GP-3..5; tests GP-ACCESS, GP-LIMIT, GP-REVOKE, GP-ISSUER*
- [ ] **T3.3** Pause, emergency exit, reentrancy guard, fee setter. *FR-GP-9; tests GP-PAUSE, GP-REENT*
- [ ] **T3.4** Fuzz and invariant tests. *GP-FUZZ-1*

### Phase 4: Off-chain (Days 15-19)
- [ ] **T4.1** Issuer service: DID doc, VC issuance with `did-jwt-vc`, EIP-712 signing. *FR-ID-1..4*
- [ ] **T4.2** Encryption + IPFS upload/download module. *FR-ID-5; E2E-3*
- [ ] **T4.3** Deploy + seed scripts, local demo (`npm run demo`). *NFR-7*
- [ ] **T4.4** Integration tests E2E-1..3.

### Phase 5: Frontend (Days 20-26)
- [ ] **T5.1** Wallet connect, network guard, DID display. *FR-UI-1*
- [ ] **T5.2** "Get verified" flow. *FR-UI-2*
- [ ] **T5.3** Swap UI with quote, slippage, gated states. *FR-UI-3*
- [ ] **T5.4** Liquidity UI + credentials page. *FR-UI-4, 5*

### Phase 6: Hardening (Days 27-30)
- [ ] **T6.1** Coverage ≥ 95/90. *NFR-2*
- [ ] **T6.2** Gas optimization pass (storage packing, `immutable`, custom errors) and `docs/GAS.md` with before/after. *NFR-3*
- [ ] **T6.3** Slither run, write `docs/SECURITY.md`. *NFR-6, section 8*
- [ ] **T6.4** Deploy to Sepolia, verify on Etherscan, record addresses in README.

### Phase 7: Stretch
- [ ] **S-1** ZK proof of claim ("tier ≥ 2" without revealing the credential), using Circom/snarkjs or Noir.
- [ ] **S-2** Mock cross-chain bridge: `BadgeMirror` on chain B accepts a message from chain A's `AccessBadge` and mints a mirrored badge; revocation messages burn it.

---

## 12. Traceability matrix

| Requirement | Contract / module | Tests |
|---|---|---|
| FR-ID-1..6 | issuer-service, frontend | E2E-1, E2E-3 |
| FR-IR-1..4 | IssuerRegistry | IR-\* |
| FR-CR-1..6 | CredentialRegistry | CR-\* |
| FR-AB-1..6 | AccessBadge | AB-\* |
| FR-GP-1..9 | GatedPool, GatedLP | GP-\* |
| FR-UI-1..5 | frontend | manual + Playwright smoke |
| NFR-1..7 | all | coverage, Slither, gas report |

Update this table whenever a requirement is added or changed. A requirement with no test is not done.

---

## 13. Definition of done

- [ ] All task checkboxes in section 11 (Phases 0 to 6) ticked
- [ ] Every test ID in section 9 exists and passes
- [ ] Coverage meets NFR-2; gas report committed
- [ ] `docs/SECURITY.md` and `docs/GAS.md` written
- [ ] Deployed and verified on Sepolia; frontend works against it
- [ ] README with architecture diagram, setup steps, a demo GIF, and addresses

---

## 14. Open questions (decide before Phase 3)

1. Should Institutional-tier users bypass swap limits entirely, or have a very high cap? (Spec assumes unlimited.)
2. Should LP tokens be transferable to unverified addresses? (Spec allows it, but removal still requires a badge.)
3. Single-issuer or multi-issuer attestations per credential (e.g. 2-of-3 issuers)? (Spec assumes single.)
4. Use `did:pkh` only, or also support `did:ethr` resolution via `ethr-did-resolver`? (Spec assumes `did:pkh` for v1.)

Record each decision here with date and rationale, then update the affected requirement IDs.
