# Zonk.fun v3 Base Sepolia deployment preparation

Use `script/DeployV3BaseSepolia.s.sol` for the endpoint-cp-v3 architecture. Do **not** use the legacy `script/DeployBaseSepolia.s.sol`; that script deploys the unrelated legacy `FeeManager`, `LiquidityManager`, and `ZonkFactory` contracts.

The script requires Base Sepolia (`chainid 84532`) and validates the supplied canonical Uniswap V3 factory, WETH, and NonfungiblePositionManager before creating contracts. It is dry-run by default. `V3_BROADCAST=true` is required to enable Foundry broadcasting in a future, separately approved operation; no deployment is performed by this change.

## Configuration

Required variables (values must be supplied privately at execution time):

| Variable | Meaning |
| --- | --- |
| `V3_GOVERNANCE_ADDRESS` | FeeManagerV3 owner/governance address |
| `V3_TREASURY_SAFE` | Initial FeeManagerV3 treasury recipient |
| `BASE_SEPOLIA_UNISWAP_V3_FACTORY` | Canonical Base Sepolia Uniswap V3 factory |
| `BASE_SEPOLIA_WETH` | Canonical Base Sepolia WETH9 |
| `BASE_SEPOLIA_NONFUNGIBLE_POSITION_MANAGER` | Canonical Base Sepolia NPM |
| `DEPLOYER_PRIVATE_KEY` | Read only by Foundry when `V3_BROADCAST=true` |
| `V3_BROADCAST` | Optional boolean; defaults to `false` |

The script never logs configuration values, private keys, RPC URLs, or environment contents. The treasury and governance addresses are parameters, not hardcoded production addresses.

For the single-script broadcast path:

`DEPLOYER_PRIVATE_KEY` address == `V3_GOVERNANCE_ADDRESS`

`V3_TREASURY_SAFE` is a separate fee recipient and does not sign deployment.

## Deployment order

1. `FeeManagerV3(governance, treasury)`
2. `GraduationManagerV3(uniswapV3Factory, weth)`
3. `ZonkFactoryV3(feeManager, graduationManager)` (also creates its immutable token and curve deployers)
4. `FeeManagerV3.setFactoryOnce(factory)`
5. `GraduationManagerV3.setFactoryOnce(factory)`
6. `PermanentLPFeeVaultV3(graduationManager, feeManager)`
7. `PermanentLPCustodianDeployerV3(graduationManager, feeVault, nonfungiblePositionManager)` (immutably creates its settlement executor)
8. Exactly one bootstrap call from the manager bootstrap authority:

   `GraduationManagerV3.bindDependenciesOnce(feeVault, custodianDeployer, nonfungiblePositionManager)`

The vault must not be bound separately by an EOA. Per-launch `PermanentResidualEscrowV3(launchToken, graduationManager, weth)` instances are created by `GraduationManagerV3` during graduation; they are not global deployment dependencies.

## Post-deployment verification

Use read-only `cast call` queries against the recorded addresses and Base Sepolia RPC configured by the operator. Verify:

- `feeManager.factory() == factory` and `graduationManager.factory() == factory`;
- `factory.feeManager() == feeManager` and `factory.graduationManager() == graduationManager`;
- vault factory, manager, WETH, and custodian-deployer relationships;
- manager vault, custodian deployer, NPM, and settlement executor bindings;
- executor manager, NPM, and WETH immutables;
- NPM `factory()` and `WETH9()` equal the canonical inputs;
- factory and manager bootstrap authorities are consumed (zero);
- chain ID is `84532` and fee tier `10000` has tick spacing `200`.

Do not include secrets in shell history or command output. Any future broadcast command must be reviewed separately and is intentionally omitted here.

## Failure and recovery

If deployment stops before a one-time binding, retain the addresses and resume only after read-only verification. If a one-time binding transaction fails, do not retry with different dependencies: inspect the immutable relationships, discard the incomplete stack if necessary, and redeploy a fresh isolated stack. Never attempt to rotate a bound factory, manager dependency, vault custodian deployer, or executor.
