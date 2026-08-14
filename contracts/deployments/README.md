# Base Sepolia deployment records

Base Sepolia uses chain ID `84532`. The tracked `base-sepolia.example.json` is
an address and transaction-hash template only; it contains no credentials.

Actual records should be saved locally as `base-sepolia.json`, which is ignored
by Git. Never put a private key, mnemonic, RPC credential, or API key in this
directory or in a committed environment file.

`V3_GOVERNANCE_ADDRESS` and `V3_TREASURY_SAFE` are separate required roles.
The deployment signer must be the configured governance address when
`V3_BROADCAST=true`; the treasury is the protocol-fee recipient. Do not
substitute either role unless the intended real-world responsibilities are
deliberately the same.

## endpoint-cp-v3 Base Sepolia deployment

The repository supports only the endpoint-cp-v3 protocol. Deployment is
performed by `DeployV3BaseSepolia`; it is a dry run unless `V3_BROADCAST=true`
is explicitly provided in the protected process environment.

```bash
cd contracts
forge script script/DeployV3BaseSepolia.s.sol:DeployV3BaseSepolia \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast
```

The script requires the Base Sepolia chain and validates the canonical Uniswap
V3 factory, WETH, and Nonfungible Position Manager before deployment. Supply
the required governance, treasury, and canonical-dependency variables through
the protected process environment. Never place private keys, RPC URLs, or real
deployment credentials in this document or an example manifest.

Deployment order is fixed and atomic where bindings are made:

1. `FeeManagerV3`
2. `GraduationManagerV3`
3. `ZonkFactoryV3`, including its immutable token and curve deployers
4. `PermanentLPFeeVaultV3`
5. `PermanentLPCustodianDeployerV3`, including its settlement executor
6. `GraduationManagerV3.bindDependenciesOnce`, which binds the vault,
   custodian deployer, and canonical position manager

The script verifies every deployed relationship before reporting addresses.
Record those addresses in a deployment manifest based on
`base-sepolia.example.json`; the example uses only zero-address placeholders.

## Launch and receipt verification

Each `ZonkFactoryV3.createToken(name, symbol, userSalt)` call atomically
deploys and registers the token and curve. There is no seed, enable-trading,
adapter-configuration, or manual graduation transaction in the V3 deployment
flow.

For a launch receipt, verify `TokenLaunchedV3` and its
`protocolVersion == "endpoint-cp-v3"`. For trades, verify `TokensBought` or
`TokensSold` against the corresponding on-chain quote. On terminal settlement,
verify `Graduated` from the curve and `GraduatedV3` from the graduation manager.
Use `cast receipt <tx-hash> --rpc-url "$BASE_SEPOLIA_RPC_URL"` for receipt
inspection.

No deployment is performed automatically by the repository test suite.
