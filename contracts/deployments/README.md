# Base Sepolia deployment records

Base Sepolia uses chain ID `84532`. The tracked `base-sepolia.example.json` is
an address and transaction-hash template only; it contains no credentials.

Actual records should be saved locally as `base-sepolia.json`, which is ignored
by Git. Never put a private key, mnemonic, RPC credential, or API key in this
directory or in a committed environment file.

`GOVERNANCE_ADDRESS` and `PROTOCOL_TREASURY` are separate required roles.
`GOVERNANCE_ADDRESS` receives the initial administrative roles, while
`PROTOCOL_TREASURY` is passed as the `FeeManager` treasury and is the only
address authorized to claim protocol fees. The deployment script rejects a
missing, malformed, or zero `PROTOCOL_TREASURY`. Do not substitute the
deployer or governance address unless the intended real-world roles are
deliberately the same.

Phase 3 core deployment does not require `DEX_ADAPTER_ADDRESS`. The deployed
`LiquidityManager` starts without an adapter, and graduation fails closed until
the governance address configures a real reviewed adapter. `DEX_ADAPTER_ADDRESS`
and `LIQUIDITY_MANAGER_ADDRESS` are Phase 10 configuration inputs only.

Deploy the contracts in dependency order:

```bash
cd contracts
Set the required variables in the protected process environment using real
Base Sepolia configuration, including `PROTOCOL_TREASURY`; do not place
credentials or wallet values in this documentation. Then run:

forge script script/DeployBaseSepolia.s.sol:DeployBaseSepolia \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast
```

The governance executor must run deployment so it can authorize the curve in
both `FeeManager` and `LiquidityManager`. The LP beneficiary must be a reviewed
Safe, timelock, or governance executor. Record
the logged factory, fee manager, liquidity manager, LP locker, and curve
addresses, then set the address and parameter variables from `.env.example`.
Run `CreateTokenBaseSepolia`, `SeedCurveBaseSepolia`, and `BuyBaseSepolia` before
testing sell. Graduation is Phase 10 only: after adapter approval and a real
adapter deployment, configure it with:

```bash
forge script script/ConfigureDexAdapterBaseSepolia.s.sol:ConfigureDexAdapterBaseSepolia \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast
```

Only then can an authorized creator or governance executor run
`GraduateBaseSepolia` with a bounded `GRADUATION_DEADLINE`.
For every broadcast, inspect the receipt and confirm `TokenCreated`,
`CurveCreated`, `TokensBought`, and `TokensSold` event data against the quote
and the onchain `curve` state. A graduation validation must additionally check
`GraduationPending`, `LiquidityCreated`, `LiquidityLocked`, and `Graduated`, the
stored graduation record, and the LP lock. Use `cast receipt <tx-hash>
--rpc-url ...` for receipt verification.

No deployment is performed automatically by the repository test suite.
