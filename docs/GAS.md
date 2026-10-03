# Gas report

Measured on 2026-10-03 with Solidity 0.8.24, optimizer enabled (500 runs), via-IR, Hardhat EVM.

Run with:

```bash
npm run gas
```

| Operation | Minimum | Maximum | Average |
|---|---:|---:|---:|
| `GatedPool.swap` | 110,017 | 110,593 | **110,225** |
| `GatedPool.addLiquidity` | 120,825 | 254,569 | 226,993 |
| `GatedPool.removeLiquidity` | — | — | 109,877 |
| `AccessBadge.claim` | 186,475 | 186,511 | 186,495 |
| `CredentialRegistry.revoke` | — | — | 30,826 |
| `GatedPool.setFee` | — | — | 30,043 |

The measured swap cost includes the live credential check and is below the specification target of 130,000 gas. Deployment averages: GatedPool 2,183,921; AccessBadge 1,900,683; CredentialRegistry 673,877; IssuerRegistry 736,777.

Gas varies with storage warmness, token implementation, badge tier, and route direction. This report is a reproducible development-chain benchmark, not a fee quote.
