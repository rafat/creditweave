## CreditWeave Contracts

This folder contains the onchain layer for CreditWeave (Sepolia deployment).

### Core Contracts

- `RWAAssetRegistry.sol`: RWA lifecycle and role-gated asset operations.
- `NAVOracle.sol`: CRE-fed NAV storage with staleness enforcement.
- `UnderwritingRegistry.sol`: legacy V1 underwriting registry (compatibility path).
- `UnderwritingRegistryV2.sol`: V2 underwriting decisions (`loanProduct`, `status`, terms, covenants, provenance).
- `RWALendingPool.sol`: collateral/borrow/repay/liquidate engine with:
  - optional V2 underwriting adapter
  - optional portfolio risk adapter
  - reserve accounting and optional loss waterfall integration
- `PortfolioRiskRegistry.sol`: segment-level throttles/haircuts and exposure thresholds.
- `LossWaterfall.sol`: junior/senior capital buckets for bad-debt absorption.

### Deploy Scripts

- `script/DeployRWAContracts.s.sol`: deploys registry + demo stablecoin.
- `script/DeployCreditWeave.s.sol`: deploys core credit stack and wires adapters.
- `script/DeployAll.s.sol`: full deployment + liquidity seeding + `deployments.json`.
- `script/TokenizeAsset.s.sol`: registers/tokenizes an asset and configures:
  - pool token + logic mappings
  - V2 `setAssetLoanProduct(...)` (if `UNDERWRITING_REGISTRY_V2` provided)
  - portfolio segment assignment (if `PORTFOLIO_RISK_REGISTRY` + `SEGMENT_ID` provided)

### Build and Test

```sh
forge build
forge test
```

### Deploy (Sepolia)

Run from `contracts/`:

```sh
forge script script/DeployAll.s.sol --rpc-url sepolia --private-key "$PRIVATE_KEY" --broadcast --verify --chain-id 11155111 -vvvv
```

Deployment output is written to:

- `contracts/deployments.json`
- `contracts/broadcast/DeployAll.s.sol/11155111/run-latest.json`

### Required Environment Variables

- `PRIVATE_KEY`: deployer key for Foundry scripts.
- `SEPOLIA_FORWARDER`: Chainlink forwarder address used by receiver contracts.

Tokenization script inputs (backend route injects these):

- `NEXT_PUBLIC_RWA_ASSET_REGISTRY`
- `NEXT_PUBLIC_LENDING_POOL`
- `PROPERTY_ADDRESS`
- `ASSET_VALUE`
- `RENT_AMOUNT`
- `ORIGINATOR`
- Optional: `UNDERWRITING_REGISTRY_V2`, `LOAN_PRODUCT` (`1|2|3`)
- Optional: `PORTFOLIO_RISK_REGISTRY`, `SEGMENT_ID` (`bytes32`)

### Notes

- V2 is the active underwriting path for CRE/frontend.
- Keep `deployments.json` as the source of truth and run monorepo sync after deployment:

```sh
cd ..
npm run sync-artifacts
```

