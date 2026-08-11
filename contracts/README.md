# Zonk.fun contracts

The contract layer is the source of truth for token creation, curve inventory,
trading reserve, fee policy, and accrued fee liabilities.

Current modules:

- `ZonkFactory`: permissionless token creation and creator registry;
- `ZonkToken`: fixed-supply ERC-20 initialized once by the factory;
- `ZonkCurve`: native-asset linear bonding curve and reserve accounting;
- `FeeManager`: governed, capped fee policy and pull-payment accounting;
- `LiquidityManager`: atomic graduation coordinator with an immutable DEX
  adapter boundary;
- `LPLocker`: enforced time lock for fungible LP receipts returned by the
  adapter.

No DEX protocol is selected in this repository. A reviewed adapter for the
selected Base DEX remains required before testnet deployment. The adapter must
represent every position as a transferable ERC-20 LP receipt; NFT positions
must be wrapped or custody-normalized by the adapter before integration.

See [FEE_ARCHITECTURE.md](./FEE_ARCHITECTURE.md) for fee calculations, roles,
claims, and reserve isolation. See
[LIQUIDITY_ARCHITECTURE.md](./LIQUIDITY_ARCHITECTURE.md) for graduation,
adapter, LP-lock, recovery, and governance boundaries.

## Local validation

```shell
forge fmt --check
forge build
forge test
```

Deployment scripts read runtime configuration through environment-variable
names. Never pass or commit private keys, mnemonics, authenticated RPC URLs, or
other credentials in source files or command arguments. No deployment is part
of the local test suite.
