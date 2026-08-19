# Zonk.fun v3 Base Mainnet deployment preparation

Use `script/DeployV3BaseMainnet.s.sol` for the endpoint-cp-v3 architecture on
Base Mainnet (`chainid 8453`). Do **not** use `script/DeployV3BaseSepolia.s.sol`
or any legacy deployer against Mainnet.

This document is a dry-run / operator-preparation guide. It does **not**
authorize a live Mainnet broadcast. Phase 11D.3 implements the deployment path
only. A later, separately approved operator step is required before any
transaction is submitted to Base Mainnet.

## Canonical configuration

| Item | Value |
| --- | --- |
| Chain ID | `8453` (Base Mainnet) |
| Uniswap V3 Factory | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` |
| WETH | `0x4200000000000000000000000000000000000006` |
| NonfungiblePositionManager | `0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1` |
| Pool fee | `10000` |
| Tick spacing | `200` |
| Temporary Mainnet deployer EOA | `0x2e9f4a39F0530FC8521997d9eC634A637d49FBac` |
| Protocol/Governance Safe (`V3_TREASURY_SAFE`) | `0x71B20D47152Cdf6f9bb1b0CCd0C0FBA52b86a102` |
| Community Treasury Safe (`V3_COMMUNITY_TREASURY_SAFE`) | `0x11Dbc46C527a76EE9bf167835478EC06F73B7f4b` |

Both Safes are Base Mainnet 2-of-3 Safes. The script hard-requires
`block.chainid == 8453` and rejects any env value that does not match the
canonical Uniswap, WETH, NPM, and Safe addresses above.

`feeAmountTickSpacing(10000)` must equal `200`.
`NPM.factory()` must equal the canonical factory.
`NPM.WETH9()` must equal the canonical WETH.

## Temporary deployer governance model

1. The dedicated Mainnet deployer EOA is the Foundry signer.
2. During bootstrap, that EOA is the initial persistent owner of
   `FeeManagerV3`, `TokenCommunityVaultV3`, and `TraderRewardsDistributorV3`,
   so one-shot bootstrap calls can complete.
3. After every bootstrap authority is consumed (`address(0)`), the script calls
   `transferOwnership(Protocol/Governance Safe)` on those three contracts.
4. The script does **not** call `acceptOwnership()`. Current owner remains the
   deployer; `pendingOwner()` becomes the Protocol/Governance Safe.
5. A later, separately approved 2-of-3 Safe transaction must call
   `acceptOwnership()` on each of the three contracts.

The Protocol/Governance Safe is also the FeeManager protocol treasury. The
Community Treasury Safe is the TokenCommunityVault treasury. Those treasury
roles are distinct from ownership. The Community Treasury Safe does not receive
Ownable2Step ownership.

## Signer model — `--sender` plus encrypted Foundry keystore

`DeployV3BaseMainnet.s.sol` requires `msg.sender` to equal the expected Mainnet
deployer, then broadcasts as that validated caller. It never reads
`DEPLOYER_PRIVATE_KEY`, a mnemonic, a keystore password, or any other secret.

Foundry `--sender` sets the script `msg.sender`. `--account` only unlocks a
keystore for signing. **`--account` alone does not set `msg.sender`.**

Required operator pattern:

- Simulation may use explicit `--sender` for the expected deployer.
- Keystore-backed signing/broadcast MUST use **both**:
  - `--account zonk-mainnet-deployer`
  - `--sender 0x2e9f4a39F0530FC8521997d9eC634A637d49FBac`
- Never use `--private-key`.
- Never put a raw private key in env.

If `msg.sender` is not the expected temporary Mainnet deployer, deployment
reverts. `DEPLOYER_PRIVATE_KEY` exists only for the Base Sepolia / legacy path
and is **not** the Mainnet signing method.

## Environment (public addresses only)

Required public variables:

| Variable | Meaning |
| --- | --- |
| `V3_TREASURY_SAFE` | Must equal the Protocol/Governance Safe |
| `V3_COMMUNITY_TREASURY_SAFE` | Must equal the Community Treasury Safe |
| `BASE_MAINNET_UNISWAP_V3_FACTORY` | Must equal the canonical factory |
| `BASE_MAINNET_WETH` | Must equal the canonical WETH |
| `BASE_MAINNET_NONFUNGIBLE_POSITION_MANAGER` | Must equal the canonical NPM |
| `BASE_MAINNET_RPC_URL` | Read-only RPC for simulation |

Never set `BASE_SEPOLIA_*` Uniswap variables for this script. Never put a
Mainnet private key in the environment file.

The script never logs configuration values, private keys, RPC URLs, or
environment contents.

## Deployment graph

The Mainnet graph and ordering are the same as `DeployV3BaseSepolia`, plus the
ownership handoff after bootstrap consumption:

1. `FeeManagerV3(deployer, protocolTreasury)`
2. `GraduationManagerV3(uniswapV3Factory, weth)`
3. `ZonkFactoryV3(feeManager, graduationManager)` (also creates its immutable token and curve deployers)
4. `FeeManagerV3.setFactoryOnce(factory)`
5. `GraduationManagerV3.setFactoryOnce(factory)`
6. `TokenCommunityVaultV3(deployer, communityTreasury, feeManager)`
7. `TraderRewardsVaultV3(deployer, feeManager)`
8. `TraderRewardsDistributorV3(deployer, rewardsVault)`
9. `TraderRewardsVaultV3.setDistributorOnce(distributor)`
10. `FeeManagerV3.bindEcosystemVaultsOnce(communityVault, rewardsVault)`
11. `PermanentLPFeeVaultV3(graduationManager, feeManager, communityVault, rewardsVault)`
12. `TokenCommunityVaultV3.setPermanentLPFeeVaultOnce(feeVault)`
13. `TraderRewardsVaultV3.setPermanentLPFeeVaultOnce(feeVault)`
14. `PermanentLPCustodianDeployerV3(graduationManager, feeVault, nonfungiblePositionManager)` (immutably creates its settlement executor)
15. Exactly one bootstrap call from the manager bootstrap authority:

    `GraduationManagerV3.bindDependenciesOnce(feeVault, custodianDeployer, nonfungiblePositionManager)`
16. Verify every bootstrap authority below is `address(0)` **before** treating ownership handoff as valid
17. `FeeManagerV3.transferOwnership(Protocol/Governance Safe)`
18. `TokenCommunityVaultV3.transferOwnership(Protocol/Governance Safe)`
19. `TraderRewardsDistributorV3.transferOwnership(Protocol/Governance Safe)`

The LP vault must not be bound separately by an EOA. Per-launch
`PermanentResidualEscrowV3(launchToken, graduationManager, weth)` instances are
created by `GraduationManagerV3` during graduation; they are not global
deployment dependencies.

## Bootstrap authorities that must be zero before handoff

Ownership handoff is invalid unless all of the following are `address(0)`:

- `FeeManager.factoryBootstrapAuthority`
- `FeeManager.ecosystemBootstrapAuthority`
- `GraduationManager.factoryBootstrapAuthority`
- `GraduationManager.dependencyBootstrapAuthority`
- `TokenCommunityVault.lpFeeVaultBootstrapAuthority`
- `TraderRewardsVault.bootstrapAuthority`
- `PermanentLPFeeVault.custodianDeployerBootstrapAuthority`

## Simulation (no broadcast)

Dry-run is the default Foundry script path. Do **not** pass `--broadcast`.

```bash
cd contracts
forge script script/DeployV3BaseMainnet.s.sol \
  --rpc-url "$BASE_MAINNET_RPC_URL" \
  --sender 0x2e9f4a39F0530FC8521997d9eC634A637d49FBac
```

This simulates the full signer-sensitive graph, including one-shot binds and
`transferOwnership`, and must not send transactions. `--sender` is what sets
script `msg.sender` to the expected deployer. Do not include `--broadcast`.
Do not use `--private-key`. Do not put a raw private key in env.

## Live broadcast

Live broadcast is a **separate manual operator step** and must **not** be
executed by the Phase 11D.3 implementation task.

Keystore-backed signing/broadcast MUST use **both** of these flags (in addition
to the simulation arguments above). `--account` does not replace `--sender`:

```text
--account zonk-mainnet-deployer
--sender 0x2e9f4a39F0530FC8521997d9eC634A637d49FBac
```

Broadcast only after an explicit, separately approved decision by adding
Foundry’s `--broadcast` flag to that keystore-backed command. Do not enable any
repository-specific broadcast environment flag. Never use `--private-key`.
Never put a raw private key in env.

A copy-paste production broadcast command is intentionally omitted here.

## Safe acceptOwnership (separate governance step)

After a successful deployment, the Protocol/Governance Safe (`2-of-3`) must
manually approve and execute `acceptOwnership()` on:

- `FeeManagerV3`
- `TokenCommunityVaultV3`
- `TraderRewardsDistributorV3`

Until those three Safe transactions are executed:

- `owner()` remains the temporary deployer
- `pendingOwner()` is the Protocol/Governance Safe

The deployment script must never call `acceptOwnership()`.

## Post-deployment verification

The script already asserts the following after bootstrap and handoff.
Operators should also re-check with read-only `cast call` queries against the
recorded addresses and the operator-configured Base Mainnet RPC:

- `feeManager.factory() == factory` and `graduationManager.factory() == factory`;
- `factory.feeManager() == feeManager` and `factory.graduationManager() == graduationManager`;
- community, rewards, distributor, and LP vault cross-bindings;
- `rewardsVault.distributor() == distributor` and `distributor.rewardsVault() == rewardsVault`;
- `feeVault.communityVault()` / `feeVault.traderRewardsVault()` match the deployed vaults;
- manager vault, custodian deployer, NPM, and settlement executor bindings;
- executor manager, NPM, and WETH immutables;
- NPM `factory()` and `WETH9()` equal the canonical Mainnet inputs;
- protocol treasury == Protocol/Governance Safe and community treasury == Community Treasury Safe;
- FeeManager, community vault, and distributor `owner()` == temporary deployer;
- FeeManager, community vault, and distributor `pendingOwner()` == Protocol/Governance Safe;
- factory, ecosystem, rewards, community LP, LP custodian-deployer, and manager dependency bootstrap authorities are consumed (`address(0)`);
- `protocolVersionHash() == keccak256("endpoint-cp-v3")`;
- `feePolicyHash() == keccak256("zonk-fee-design-b-v3")` (`EndpointConstantsV3.FEE_POLICY_HASH`);
- chain ID is `8453` and fee tier `10000` has tick spacing `200`.

Record verified addresses in a local `contracts/deployments/base-mainnet.json`
copied from `base-mainnet.example.json`. That local file is gitignored.

## Trader rewards operator invariant

`TraderRewardsDistributorV3` is policy-agnostic. It does **not** reserve, lock,
cancel, or claw back published roots.

For each `(launchToken, asset)`:

- the operator MUST NOT publish a new root whose still-unpaid authorized claims, combined with previously published still-unpaid distributions, exceed available or committed rewards funding;
- roots are immutable after publication;
- vault balances are pooled per `(launchToken, asset)`;
- overcommit can starve later valid claimants in claim-order;
- a failed claim does not set `claimed` and may retry after additional funding.

This is an operational invariant for the MVP distributor, not an on-chain reservation guarantee.

## Failure and recovery

If simulation fails on chain ID, canonical Uniswap/WETH/NPM, tick spacing, NPM
relationships, or signer mismatch: do not broadcast. Fix the RPC, env values, or
unlocked account and re-simulate.

If a live deployment (later operator step) stops before a one-time binding,
retain the addresses and resume only after read-only verification. If a one-time
binding transaction fails, do not retry with different dependencies: inspect the
immutable relationships, discard the incomplete stack if necessary, and redeploy
a fresh isolated stack. Never attempt to rotate a bound factory, manager
dependency, vault custodian deployer, or executor.

If the stack is fully bootstrapped (all authorities `address(0)`) but
`transferOwnership` did not land, the deployer can still call
`transferOwnership(Protocol/Governance Safe)` manually. Do not call
`acceptOwnership()` from the deployer.

If `transferOwnership` succeeded but the Safe has not accepted, the deployer is
still owner. Do not renounce ownership. Do not transfer to any address other
than the Protocol/Governance Safe. Complete the Safe `acceptOwnership` 2-of-3
ceremony.

If the wrong signer was used, the script reverts before deployment. Do not
attempt to “fix” a signer mismatch by pasting a private key into `.env`.
