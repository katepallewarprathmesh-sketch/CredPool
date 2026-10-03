# Changelog

## v1.1.0 — 2026-10-03

- Added real Pinata/IPFS storage behind a configurable adapter.
- Moved credential encryption to the holder browser using a wallet-signature-derived AES-256-GCM key.
- Added rolling 24-hour per-holder volume limits to prevent split-swap bypasses.
- Added EIP-5192/ERC-165 badge discovery and hosted ERC-1155 metadata.
- Added atomic EIP-2612 permit swaps.
- Added multisig-controlled `CredPoolTimelock` deployment and deployer role renunciation.
- Added Foundry fuzz/invariant and Playwright connect/verify/swap suites.
- Added authenticated, rate-limited revoke APIs and real VC/DID verification.
- Added optional `did:ethr` resolution and W3C Bitstring Status Lists.
- Raised Solidity branch coverage to 95.05%; maximum measured swap remains under 130k gas.

## v1.0.0 — 2026-10-03

Initial credential-gated AMM implementation.
