# Zonk.fun v3 Base Sepolia deployment preparation

Use `script/DeployV3BaseSepolia.s.sol` for the endpoint-cp-v3 architecture. Do **not** use the legacy `script/DeployBaseSepolia.s.sol`; that script deploys the unrelated legacy `FeeManager`, `LiquidityManager`, and `ZonkFactory` contracts.

The script requires Base Sepolia (`chainid 84532`) and validates the supplied canonical Uniswap V3 factory, WETH, and NonfungiblePositionManager before creating contracts.

Simulation and broadcast share the same signer-sensitive bootstrap graph. `vm.startBroadcast` is always used so one-shot binds execute as `V3_GOVERNANCE_ADDRESS`. Actual network submission is controlled only by Foundry’s `forge script --broadcast` flag. Do not invent a second custom broadcast switch.

## Configuration

Required variables (values must be supplied privately at execution time):

| Variable | Meaning |
| --- | --- |
| `V3_GOVERNANCE_ADDRESS` | Owner/governance for FeeManagerV3, TokenCommunityVaultV3, and TraderRewardsDistributorV3. Must equal the deployment signer. |
| `V3_TREASURY_SAFE` | Initial FeeManagerV3 protocol treasury recipient |
| `V3_COMMUNITY_TREASURY_SAFE` | Initial TokenCommunityVaultV3 treasury recipient |
| `BASE_SEPOLIA_UNISWAP_V3_FACTORY` | Canonical Base Sepolia Uniswap V3 factory |
| `BASE_SEPOLIA_WETH` | Canonical Base Sepolia WETH9 |
| `BASE_SEPOLIA_NONFUNGIBLE_POSITION_MANAGER` | Canonical Base Sepolia NPM |
| `DEPLOYER_PRIVATE_KEY` | Required for both dry-run simulation and broadcast so bootstrap `msg.sender` matches governance |

The script never logs configuration values, private keys, RPC URLs, or environment contents. Treasury and governance addresses are parameters, not hardcoded production addresses.

Signer rule:

`DEPLOYER_PRIVATE_KEY` address == `V3_GOVERNANCE_ADDRESS`

`V3_TREASURY_SAFE` and `V3_COMMUNITY_TREASURY_SAFE` are fee recipients and do not sign deployment.

## Deployment order

1. `FeeManagerV3(governance, protocolTreasury)`
2. `GraduationManagerV3(uniswapV3Factory, weth)`
3. `ZonkFactoryV3(feeManager, graduationManager)` (also creates its immutable token and curve deployers)
4. `FeeManagerV3.setFactoryOnce(factory)`
5. `GraduationManagerV3.setFactoryOnce(factory)`
6. `TokenCommunityVaultV3(governance, communityTreasury, feeManager)`
7. `TraderRewardsVaultV3(governance, feeManager)`
8. `TraderRewardsDistributorV3(governance, rewardsVault)`
9. `TraderRewardsVaultV3.setDistributorOnce(distributor)`
10. `FeeManagerV3.bindEcosystemVaultsOnce(communityVault, rewardsVault)`
11. `PermanentLPFeeVaultV3(graduationManager, feeManager, communityVault, rewardsVault)`
12. `TokenCommunityVaultV3.setPermanentLPFeeVaultOnce(feeVault)`
13. `TraderRewardsVaultV3.setPermanentLPFeeVaultOnce(feeVault)`
14. `PermanentLPCustodianDeployerV3(graduationManager, feeVault, nonfungiblePositionManager)` (immutably creates its settlement executor)
15. Exactly one bootstrap call from the manager bootstrap authority:

    `GraduationManagerV3.bindDependenciesOnce(feeVault, custodianDeployer, nonfungiblePositionManager)`

The LP vault must not be bound separately by an EOA. Per-launch `PermanentResidualEscrowV3(launchToken, graduationManager, weth)` instances are created by `GraduationManagerV3` during graduation; they are not global deployment dependencies.

## Dry-run procedure

Dry-run is the default Foundry script path. Do **not** pass `--broadcast`.

```bash
cd contracts
forge script script/DeployV3BaseSepolia.s.sol \
  --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

This simulates the full signer-sensitive graph, including one-shot binds, and must not send transactions. `DEPLOYER_PRIVATE_KEY` is still required so bootstrap calls execute as governance.

## Broadcast procedure

Broadcast only after an explicit, separately approved Stage 5 decision. Add Foundry’s `--broadcast` flag to the same command. Do not enable any repository-specific broadcast environment flag.

Never include secrets in shell history or command output. Any future broadcast command must be reviewed separately; a copy-paste production command is intentionally omitted here.

## Post-deployment verification

The script already asserts the following after bootstrap. Operators should also re-check with read-only `cast call` queries against the recorded addresses and the operator-configured Base Sepolia RPC:

- `feeManager.factory() == factory` and `graduationManager.factory() == factory`;
- `factory.feeManager() == feeManager` and `factory.graduationManager() == graduationManager`;
- community, rewards, distributor, and LP vault cross-bindings;
- `rewardsVault.distributor() == distributor` and `distributor.rewardsVault() == rewardsVault`;
- `feeVault.communityVault()` / `feeVault.traderRewardsVault()` match the deployed vaults;
- manager vault, custodian deployer, NPM, and settlement executor bindings;
- executor manager, NPM, and WETH immutables;
- NPM `factory()` and `WETH9()` equal the canonical inputs;
- protocol treasury == `V3_TREASURY_SAFE` and community treasury == `V3_COMMUNITY_TREASURY_SAFE`;
- FeeManager, community vault, and distributor owners == `V3_GOVERNANCE_ADDRESS`;
- factory, ecosystem, rewards, community LP, LP custodian-deployer, and manager dependency bootstrap authorities are consumed (`address(0)`);
- `feePolicyHash() == keccak256("zonk-fee-design-b-v3")` on FeeManager, community vault, rewards vault, distributor, and LP vault;
- chain ID is `84532` and fee tier `10000` has tick spacing `200`.

## Trader rewards operator invariant

`TraderRewardsDistributorV3` is policy-agnostic. It does **not** reserve, lock, cancel, or claw back published roots.

For each `(launchToken, asset)`:

- the operator MUST NOT publish a new root whose still-unpaid authorized claims, combined with previously published still-unpaid distributions, exceed available or committed rewards funding;
- roots are immutable after publication;
- vault balances are pooled per `(launchToken, asset)`;
- overcommit can starve later valid claimants in claim-order;
- a failed claim does not set `claimed` and may retry after additional funding.

This is an operational invariant for the MVP distributor, not an on-chain reservation guarantee.

## Failure and recovery

If deployment stops before a one-time binding, retain the addresses and resume only after read-only verification. If a one-time binding transaction fails, do not retry with different dependencies: inspect the immutable relationships, discard the incomplete stack if necessary, and redeploy a fresh isolated stack. Never attempt to rotate a bound factory, manager dependency, vault custodian deployer, or executor.
