# Fee architecture and trust boundaries

## Modules

- `ZonkFactory` creates fixed-supply `ZonkToken` contracts and records each
  creator on-chain.
- `ZonkCurve` escrows token inventory and native-asset trading reserve. It has
  an immutable `FeeManager` reference and cannot change fee policy.
- `FeeManager` stores fee policy, token-to-creator registration, protocol fee
  liabilities, and creator fee liabilities. It never receives trading reserve.
- `LiquidityManager` receives only the tracked reserve and unsold inventory of
  a curve that has entered `GraduationPending`. It has no access to FeeManager
  liabilities or active curve reserves.

Trading and fee claims are fully on-chain and do not depend on the API,
indexer, database, or any custodial backend.

## Fee policy

Rates use basis points with a denominator of 10,000. Initial rates are supplied
to `FeeManager` at deployment; no payout address or active percentage is
compiled into trading functions.

The immutable safety caps are:

- protocol fee: at most 500 bps;
- creator fee: at most 500 bps;
- combined fee: at most 1,000 bps.

Governance may configure rates within those caps. Buys round each fee upward;
sells round each fee downward. `ZonkCurve` quotes through `FeeManager`, and
execution accrues through the same FeeManager calculation, so quote and
execution share one policy and one rounding implementation.

## Accounting flow

For a buy, the trader pays curve cost plus both fees. `ZonkCurve` retains only
the curve cost as reserve and transfers exactly the calculated fees to
`FeeManager`. For a sell, `ZonkCurve` removes the full curve value from reserve,
pays the seller the value net of fees, and transfers exactly the fees to
`FeeManager`.

Each token is registered once by its authorized curve with its immutable
creator account. FeeManager maintains independent liabilities:

- `protocolFeesAccrued`;
- `creatorFeesAccrued[token]`;
- `totalCreatorFeesAccrued`.

The FeeManager balance must be at least the sum of those liabilities. Forced
native asset is not added to liabilities and cannot be withdrawn through an
administrative sweep.

## Claims and access control

- `CURVE_ROLE` permits token registration and fee accrual. Accrual is also
  restricted to the exact curve registered for that token.
- `FEE_CONFIG_ROLE` permits capped fee-rate and treasury changes.
- `DEFAULT_ADMIN_ROLE` manages roles and should be held by a reviewed Safe or
  governance executor.
- A creator may claim only the accrued fees for a token whose registered
  creator equals the caller.
- The current treasury may claim only `protocolFeesAccrued`.

Claims use checks-effects-interactions and reentrancy protection. A receiver
that rejects native asset can delay only its own claim; it cannot block trading
or redirect reserve. No contract exposes an unrestricted withdrawal or reserve
seizure function.

## Deployment order

1. Deploy `ZonkFactory`.
2. Deploy `FeeManager` with governance, treasury, and capped initial rates.
3. Deploy `LiquidityManager` with governance, a reviewed DEX adapter, the LP
   beneficiary, lock duration, and capped liquidity slippage.
4. Deploy `ZonkCurve` with immutable factory, FeeManager, and LiquidityManager
   addresses.
5. From governance, grant `CURVE_ROLE` to `ZonkCurve` in both managers.

Changing role holders or treasury addresses emits OpenZeppelin role events or
`TreasuryUpdated`. Fee-rate changes emit `FeeConfigurationUpdated`; registration,
accrual, and claims each emit canonical accounting events.

## Deliberate limitations

- Configuration changes are immediate. A Safe can hold the roles now; a
  timelock can be granted the roles later without upgrading the contracts.
- Existing fee liabilities follow the current treasury after a transparent
  treasury change.
- Forced native asset cannot be recovered because adding an administrative
  sweep would weaken the no-seizure boundary.
- The selected DEX adapter remains a deployment-time trust boundary and must be
  reviewed against the requirements in `LIQUIDITY_ARCHITECTURE.md`.
