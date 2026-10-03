# Gas report

Measured on 2026-10-03 with Solidity 0.8.24, optimizer enabled (500 runs), via-IR, Hardhat EVM, after rolling-volume accounting and packed window storage were added.

Run with:

```bash
npm run gas
```

| Operation                   | Minimum | Maximum |                 Average |
| --------------------------- | ------: | ------: | ----------------------: |
| `GatedPool.swap`            | 102,717 | 128,085 |             **108,571** |
| `GatedPool.addLiquidity`    |  varies |  varies | see reproducible report |
| `GatedPool.removeLiquidity` |  varies |  varies | see reproducible report |
| `AccessBadge.claim`         |  varies |  varies | see reproducible report |

The maximum measured swap, including live credential validation and rolling-window volume accounting, remains below the 130,000-gas target. The first swap in a new volume window costs more because it initializes packed accounting storage; subsequent swaps update the same slot.

Gas varies with storage warmness, token implementation, badge tier, and route direction. This is a development-chain benchmark, not a fee quote.
