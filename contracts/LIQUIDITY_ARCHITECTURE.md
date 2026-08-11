# Graduation and liquidity architecture

## Lifecycle and threshold

Each curve has one explicit lifecycle:

1. `Active`: buys and sells are enabled.
2. `GraduationPending`: reached atomically after a successful buy makes
   `soldSupply == graduationThreshold`; all curve trading is disabled.
3. `Graduated`: external liquidity was created and the LP receipt was locked.

The threshold is configured per curve in token base units. It must be positive
and strictly less than `curveSupply`, ensuring graduation has token inventory
for liquidity. It is also a hard buy ceiling: a buy that would make sold supply
exceed the threshold reverts, so pending curves always reach the threshold
exactly. A curve can move only forward through these states. Graduation
may be called by the recorded creator or an account with the LiquidityManager
`GRADUATION_EXECUTOR_ROLE`, intended for a Safe or governance executor.

## Graduation accounting

At graduation, the curve migrates exactly:

- token amount: `curveSupply - soldSupply`, the complete unsold escrow;
- quote amount: `reserveBalance`, the complete tracked native-ETH reserve.

The amounts are computed on-chain. Protocol and creator fee liabilities live
in FeeManager and are never included. Untracked or forcibly sent ETH is not
included. ZonkCurve sets its lifecycle and reserve accounting before the
external call, relying on transaction atomicity to restore the pending state if
any downstream operation fails.

LiquidityManager requires the adapter to consume exactly both desired amounts.
It also supplies minimum amounts calculated on-chain as
`ceil(desired * (10_000 - maxSlippageBps) / 10_000)`. Exact-consumption checks
are intentionally stricter than these minima for the initial integration: no
token or quote refund can become stranded or silently alter migration
accounting. The deployment-time slippage cap cannot exceed 1,000 bps.

## DEX adapter boundary

`IDEXAdapter` isolates all DEX-specific pool/router/position-manager behavior.
LiquidityManager holds one immutable adapter and validates the adapter's
reported values against actual balance changes. The adapter must:

- create liquidity using the supplied token and native ETH;
- enforce the supplied deadline and minimum amounts;
- consume exactly the approved desired amounts;
- return a nonzero, contract-backed, transferable ERC-20 LP receipt;
- deliver exactly the reported LP amount to LiquidityManager;
- normalize an NFT liquidity position into a reviewed fungible receipt if the
  selected DEX does not issue fungible LP tokens.

No DEX or protocol address is hardcoded. A concrete adapter and its router,
factory, pool, or position-manager configuration must be selected, implemented,
and independently reviewed before Base Sepolia validation. A malicious adapter
that behaves consistently while routing assets to an economically invalid pool
cannot be detected generically; adapter review is therefore a deployment
blocker and explicit trust assumption.

## LP ownership and lock

Every LP receipt is transferred atomically into `LPLocker`. Each lock records
the immutable beneficiary selected when LiquidityManager is deployed, amount,
asset, and unlock timestamp. Only the beneficiary can claim, only after the
timestamp, and only once. The lock duration is immutable and bounded from 30
days to 10 years. There is no early unlock, administrative withdrawal, rescue,
or arbitrary transfer function.

The beneficiary should be a reviewed Safe, timelock, or governance executor;
it must not be an uncontrolled personal wallet. The current model is a timed
lock, not a permanent burn. Governance policy for LP ownership after unlock
must be approved before deployment.

## Failure and recovery

There is no administrative recovery state or reserve sweep. Adapter failures,
invalid LP assets, partial consumption, zero liquidity, transfer-tax behavior,
and lock failures revert the entire graduation transaction. The curve remains
`GraduationPending`, its tracked reserve and token inventory remain intact, and
the same authorized caller may retry. The immutable adapter cannot be replaced
after deployment, preventing an administrator from redirecting pending
reserves; an adapter defect requires a reviewed redeployment and migration
decision rather than an in-contract seizure path.

## Roles and trust assumptions

- FeeManager `CURVE_ROLE`: token fee registration and fee accrual by the exact
  registered curve.
- LiquidityManager `CURVE_ROLE`: token registration and migration by the exact
  registered curve.
- LiquidityManager `GRADUATION_EXECUTOR_ROLE`: may trigger an already eligible
  graduation, but cannot choose amounts, adapter, LP recipient, or withdraw
  assets.
- `DEFAULT_ADMIN_ROLE`: role management only; it has no withdrawal capability.
- Creator: may trigger only its token's eligible graduation.
- LP beneficiary: may claim only a matured LP lock.

Trading and graduation remain fully on-chain and do not depend on a backend,
database, or off-chain calculation.

## Known limitations requiring approval

- The target Base DEX and concrete adapter are not yet selected.
- The LP beneficiary and post-unlock governance policy are not yet approved.
- The immutable-adapter design deliberately has no emergency asset recovery.
- External liquidity pricing is determined from all remaining inventory and all
  reserve; whether that ratio is suitable for the selected DEX must be validated
  economically before deployment.
- No Base Sepolia deployment or live create/buy/sell/graduation flow has been
  performed.
