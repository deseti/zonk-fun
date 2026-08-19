# Deployment records

Tracked files in this directory are address and transaction-hash templates
only. They contain no credentials. Actual records should be saved locally as
`base-sepolia.json` or `base-mainnet.json`, which are ignored by Git. Never put
a private key, mnemonic, keystore password, RPC credential, or API key in this
directory or in a committed environment file.

The repository deploys the current endpoint-cp-v3 family; there is no V4 stack.

| Network | Chain ID | Guide | Template |
| --- | --- | --- | --- |
| Base Sepolia | `84532` | `contracts/docs/DEPLOY_V3_BASE_SEPOLIA.md` | `base-sepolia.example.json` |
| Base Mainnet | `8453` | `contracts/docs/DEPLOY_V3_BASE_MAINNET.md` | `base-mainnet.example.json` |

This file is only a record/helper summary.

## Base Sepolia

Base Sepolia uses chain ID `84532`. The tracked `base-sepolia.example.json` is
an address and transaction-hash template only; it contains no credentials.

The canonical deployment guide is `contracts/docs/DEPLOY_V3_BASE_SEPOLIA.md`.

### Required environment

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
`V3_GOVERNANCE_ADDRESS`. This Sepolia-only key variable is **not** the Base
Mainnet signing method.

### Dry-run vs broadcast

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

## Base Mainnet

Base Mainnet uses chain ID `8453`. The tracked `base-mainnet.example.json` is
a public-address and placeholder template only; deployed contract fields are
zero until replaced from a verified receipt.

The canonical deployment guide is `contracts/docs/DEPLOY_V3_BASE_MAINNET.md`.

Canonical public configuration:

| Item | Address / value |
| --- | --- |
| Uniswap V3 Factory | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` |
| WETH | `0x4200000000000000000000000000000000000006` |
| NonfungiblePositionManager | `0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1` |
| Pool fee / tick spacing | `10000` / `200` |
| Temporary deployer EOA | `0x2e9f4a39F0530FC8521997d9eC634A637d49FBac` |
| Protocol/Governance Safe | `0x71B20D47152Cdf6f9bb1b0CCd0C0FBA52b86a102` |
| Community Treasury Safe | `0x11Dbc46C527a76EE9bf167835478EC06F73B7f4b` |

### Required environment

Supply these through the protected process environment. Values must match the
canonical table. Use `BASE_MAINNET_*` names; never `BASE_SEPOLIA_*`.

| Variable | Role |
| --- | --- |
| `V3_TREASURY_SAFE` | Protocol/Governance Safe; FeeManager treasury and pending owner |
| `V3_COMMUNITY_TREASURY_SAFE` | Community Treasury Safe; TokenCommunityVault treasury |
| `BASE_MAINNET_UNISWAP_V3_FACTORY` | Canonical Uniswap V3 factory |
| `BASE_MAINNET_WETH` | Canonical WETH9 |
| `BASE_MAINNET_NONFUNGIBLE_POSITION_MANAGER` | Canonical NPM |
| `BASE_MAINNET_RPC_URL` | Base Mainnet RPC for simulation |

`DeployV3BaseMainnet.s.sol` never reads `DEPLOYER_PRIVATE_KEY`. Foundry
`--sender` sets the script `msg.sender` and must equal the temporary Mainnet
deployer EOA. `--account` only unlocks a keystore for signing; it does **not**
set `msg.sender`. Never use `--private-key`. Do not put a raw Mainnet private
key in `.env`.

### Dry-run vs broadcast

`DeployV3BaseMainnet` requires `msg.sender == EXPECTED_MAINNET_DEPLOYER`, then
broadcasts as that validated caller. That does **not** send transactions by
itself.

Simulation may use explicit `--sender`:

```bash
cd contracts
forge script script/DeployV3BaseMainnet.s.sol \
  --rpc-url "$BASE_MAINNET_RPC_URL" \
  --sender 0x2e9f4a39F0530FC8521997d9eC634A637d49FBac
```

That command is simulation only. Do **not** add `--broadcast` in this
preparation phase. Keystore-backed signing/broadcast MUST use **both**
`--account zonk-mainnet-deployer` and
`--sender 0x2e9f4a39F0530FC8521997d9eC634A637d49FBac`. Live broadcast is a
separate manual operator step and is not performed by the Phase 11D.3
implementation. Never use `--private-key`.

After a future approved broadcast, the Protocol/Governance Safe must separately
accept Ownable2Step ownership. The script never calls `acceptOwnership()`.

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

Base Mainnet adds, only after every bootstrap authority is `address(0)`:

16. `FeeManagerV3.transferOwnership(Protocol/Governance Safe)`
17. `TokenCommunityVaultV3.transferOwnership(Protocol/Governance Safe)`
18. `TraderRewardsDistributorV3.transferOwnership(Protocol/Governance Safe)`

The script verifies the deployed relationships, then prints addresses. Record
them in a local manifest based on the matching example JSON (zero-address
placeholders for deployed contracts).

## Launch and receipt verification

Each `ZonkFactoryV3.createToken(name, symbol, userSalt)` call atomically
deploys and registers the token and curve. There is no seed, enable-trading,
adapter-configuration, or manual graduation transaction in the V3 deployment
flow.

For a launch receipt, verify `TokenLaunchedV3` and
`protocolVersion == "endpoint-cp-v3"`. For trades, verify `TokensBought` or
`TokensSold` against the corresponding on-chain quote. On terminal settlement,
verify `Graduated` from the curve and `GraduatedV3` from the graduation manager.
Use `cast receipt <tx-hash> --rpc-url "$BASE_SEPOLIA_RPC_URL"` or
`"$BASE_MAINNET_RPC_URL"` for receipt inspection on the matching network.

No deployment is performed automatically by the repository test suite.
