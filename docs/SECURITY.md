# Security review

Review date: 2026-10-03

## Automated checks

- Solidity compiler 0.8.24 with optimizer and via-IR: pass
- 46 Hardhat acceptance/integration tests: pass
- Solidity coverage: **100% statements, 100% lines, 95.05% branches**
- Two issuer/storage tests, including the Pinata adapter boundary: pass
- Two Playwright connect/verify/swap smoke tests: pass
- Foundry: 512 fuzz runs plus 256 invariant runs × 64 calls (16,384 stateful calls), zero invariant reverts: pass.
- Slither analyzed 57 contracts with 102 detectors: **no high or medium findings**. Remaining informational/low findings are documented below.
- npm audit reports transitive findings in the local Hardhat toolchain. The frontend reports zero vulnerabilities. Audit and pin the deployment toolchain before release.

## Controls reviewed

- EIP-712 binds attestations to chain ID and AccessBadge address; per-subject nonces prevent replay.
- OpenZeppelin ECDSA rejects malformed/high-s signatures.
- Issuers are checked at claim time and whenever credential validity is queried.
- Removing an issuer immediately disables its credentials without iterating holders.
- Badges reject holder transfers and expose EIP-5192/ERC-165 soulbound discovery.
- Registry anchoring is limited to `BADGE_ROLE`; revocation is issuer-or-admin only.
- Pool entry points use `ReentrancyGuard`, checks-effects-interactions, and `SafeERC20`.
- Fee-on-transfer assets are explicitly rejected using balance deltas.
- Rolling 24-hour volume accounting prevents split-transaction bypasses. Accounting is packed into one slot per holder.
- EIP-2612-compatible assets can use atomic permit-and-swap.
- Slippage and deadline protections are enforced.
- The first 1,000 LP units are permanently locked.
- Pausing blocks swaps/deposits but leaves verified withdrawals open.
- No PII is stored on-chain.
- The browser derives a non-exportable AES-256-GCM key from a wallet signature and encrypts before upload. The storage endpoint receives ciphertext only.
- Real Pinata/IPFS and deterministic local storage implement the same adapter interface.
- VC JWT signatures and DID documents are verified through `did-jwt-vc`; `did:pkh` and optional `did:ethr` resolution are available.
- Revoke authentication uses a required bearer secret, timing-safe comparison, and rate limiting.
- Sepolia deployment requires a multisig and transfers admin roles through `CredPoolTimelock` before the deployer renounces them.

## Slither findings accepted

- `reentrancy-benign` on `swapWithPermit`: the permit token is called before pool accounting, but the entire entry point is protected by `nonReentrant`; the input token is restricted to one of the immutable pool assets by `_swap`/`getAmountOut`.
- `timestamp` on expiry, deadline, and rolling-window comparisons: timestamps are the intended policy clock. Miner/validator timestamp tolerance is insignificant relative to credential lifetimes and the 24-hour volume window.

## Key custody

`ISSUER_PK` is deliberately a demo-only provider. It must not be used for a production issuer. A production deployment should replace the signer implementation with AWS KMS, GCP KMS, Azure Key Vault, or an HSM-backed remote signer, enforce key rotation, and prevent application processes from reading raw private-key material.

The holder encryption key is never sent to the issuer or persisted. Reproducing it requires a wallet signature over an account-and-chain-bound message. Wallets whose signatures are intentionally non-deterministic need a wrapped-key recovery design before production use.

## Known limitations

1. This is unaudited demonstration software; do not use it with production funds.
2. Tier limits convert token1 using the mutable pool reserve ratio, which can be manipulated. Production policy should use a manipulation-resistant oracle or USD-denominated accounting.
3. The AMM has no TWAP, sandwich protection, or concentrated liquidity.
4. Pinata availability and retention depend on the configured Pinata account and gateway.
5. The mock KYC passcode is deliberately non-secure.
6. LP tokens are transferable to unverified accounts, but redemption requires a live Pro credential.
7. Credential replacement invalidates the old record for access but does not mark its historical record revoked.
8. Bitstring Status List revocation is for off-chain VC consumers. On-chain badge access still requires registry revocation.
9. Emergency withdrawals require a valid credential. Governance should define an incident-recovery policy for issuer outages.
10. Sepolia deployment, Etherscan verification, and hosted frontend deployment await operator credentials.

## Recommended release gates

- Run Foundry, Slither, and dependency scanning in CI.
- Commission an independent audit.
- Configure a real multisig, delay, KMS/HSM signer, Pinata account, and role-management runbook.
- Exercise Sepolia deployment, verification, issuer rotation, status-list publication, and incident recovery.
