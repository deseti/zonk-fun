# Base Sepolia deployment records

Base Sepolia uses chain ID `84532`. The tracked `base-sepolia.example.json` is
an address and transaction-hash template only; it contains no credentials.

Actual records should be saved locally as `base-sepolia.json`, which is ignored
by Git. Never put a private key, mnemonic, RPC credential, or API key in this
directory or in a committed environment file.

The canonical deployment guide is `contracts/docs/DEPLOY_V3_BASE_SEPOLIA.md`.
This file is only a record/helper summary. The repository deploys the current
endpoint-cp-v3 family; there is no V4 stack.

## Required environment

Supply these through the protected process environment. Do not invent or
hardcode addresses here. Protocol treasury and community treasury must be
separate Safe addresses taken from the operator’s configuration.

| Variable | Role |
| --- | --- |
| `V3_GOVERNANCE_ADDRESS` | Owner/governance; must equal the deployment signer |
| `V3_TREASURY_SAFE` | Protocol treasury (FeeManagerV3) |
| `V3_COMMUNITY_TREASURY_SAFE` | Community treasury (TokenCommunityVaultV3) |
| `BASE_SEPOLIA_UNISWAP_V3_FACTORY` | Canonical Uniswap V3 factory |
| `BASE_SEPOLIA_WETH` | Canonical WETH9 |
| `BASE_SEPOLIA_NONFUNGIBLE_POSITION_MANAGER` | Canonical NPM |
| `BASE_SEPOLIA_RPC_URL` | Base Sepolia RPC for `forge script` |

`DEPLOYER_PRIVATE_KEY` is required by `DeployV3BaseSepolia.s.sol` so bootstrap
calls simulate and (if approved) broadcast as governance. Do not print it, log
it, or commit it to `.env` or this directory. The key’s address must equal
`V3_GOVERNANCE_ADDRESS`.

## Dry-run vs broadcast

`DeployV3BaseSepolia` always uses `vm.startBroadcast(...)` so one-shot binds
run as the governance signer. That does **not** send transactions by itself.

```bash
cd contracts
forge script script/DeployV3BaseSepolia.s.sol \
  --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

That command is simulation only. Actual network submission requires the Foundry
CLI `--broadcast` flag after an explicit Stage 5 approval. Do not use a custom
`V3_BROADCAST` switch; the script no longer reads one.

## Current deployment graph

1. `FeeManagerV3`
2. `GraduationManagerV3`
3. `ZonkFactoryV3`
4. `FeeManagerV3.setFactoryOnce`
5. `GraduationManagerV3.setFactoryOnce`
6. `TokenCommunityVaultV3`
7. `TraderRewardsVaultV3`
8. `TraderRewardsDistributorV3`
9. `TraderRewardsVaultV3.setDistributorOnce`
10. `FeeManagerV3.bindEcosystemVaultsOnce`
11. `PermanentLPFeeVaultV3`
12. `TokenCommunityVaultV3.setPermanentLPFeeVaultOnce`
13. `TraderRewardsVaultV3.setPermanentLPFeeVaultOnce`
14. `PermanentLPCustodianDeployerV3`
15. `GraduationManagerV3.bindDependenciesOnce`

The script verifies the deployed relationships, then prints addresses. Record
them in a local manifest based on `base-sepolia.example.json` (zero-address
placeholders only).

## Launch and receipt verification

Each `ZonkFactoryV3.createToken(name, symbol, userSalt)` call atomically
deploys and registers the token and curve. There is no seed, enable-trading,
adapter-configuration, or manual graduation transaction in the V3 deployment
flow.

For a launch receipt, verify `TokenLaunchedV3` and
`protocolVersion == "endpoint-cp-v3"`. For trades, verify `TokensBought` or
`TokensSold` against the corresponding on-chain quote. On terminal settlement,
verify `Graduated` from the curve and `GraduatedV3` from the graduation manager.
Use `cast receipt <tx-hash> --rpc-url "$BASE_SEPOLIA_RPC_URL"` for receipt
inspection.

No deployment is performed automatically by the repository test suite.
