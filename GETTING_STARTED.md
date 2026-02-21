# CreditWeave Phase 2 Quick Start

This is the shortest path to run the confidential underwriting workflow end-to-end.

## 1) Deploy Contracts

From `contracts/`:

```bash
forge script script/RedeployAll.s.sol:RedeployAll \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast
```

This deploys:
- `MockERC20`
- `RWAAssetRegistry`
- `RentalCashFlowLogic`
- `RWARevenueVault`
- `InvestorShareToken`
- `UnderwritingRegistry`
- `NAVOracle`
- `RWALendingPool`

## 2) Update CRE Addresses

Set these in both:
- `cre/my-workflow/config.staging.json`
- `cre/my-workflow/config.production.json`

Required:
- `underwritingRegistryAddress`
- `navOracleAddress`
- `lendingPoolAddress`
- `rwaAssetRegistryAddress`

## 3) Start Private APIs

From `private-apis/`:

```bash
npm install
npm run dev
```

Health check:

```bash
curl http://localhost:3001/health
```

## 4) Configure CRE Secrets

`cre/secrets.yaml` maps runtime secret IDs to env keys. Keep these env vars set:

- `GEMINI_API_KEY_ALL`
- `CRE_API_KEY_ALL`
- `WORKFLOW_OWNER_PRIVATE_KEY_ALL`
- `CRE_ETH_PRIVATE_KEY`

## 5) Typecheck Workflow

From `cre/my-workflow/`:

```bash
bun x tsc --noEmit
```

## 6) Trigger Underwriting Request

Current contract call:

```bash
cast send $UNDERWRITING_REGISTRY_ADDRESS \
  "requestUnderwriting(uint256,uint256)" \
  1 \
  700000000000000000000000 \
  --private-key $PRIVATE_KEY \
  --rpc-url $SEPOLIA_RPC_URL
```

Event emitted:

```solidity
UnderwritingRequested(address borrower, uint256 assetId, uint256 intendedBorrowAmount)
```

## 7) Run CRE Simulation for That Event

From `cre/`:

```bash
cre workflow simulate ./my-workflow \
  -T staging-settings \
  --non-interactive \
  --trigger-index 0 \
  --evm-tx-hash <UNDERWRITING_REQUEST_TX_HASH> \
  --evm-event-index 0 \
  --broadcast
```

## 8) Verify Onchain Results

```bash
cast call $UNDERWRITING_REGISTRY_ADDRESS \
  "getTerms(address,uint256)" \
  <BORROWER_ADDRESS> \
  1 \
  --rpc-url $SEPOLIA_RPC_URL
```

And confirm pending request got cleared:

```bash
cast call $UNDERWRITING_REGISTRY_ADDRESS \
  "getRequestedBorrowAmount(address,uint256)" \
  <BORROWER_ADDRESS> \
  1 \
  --rpc-url $SEPOLIA_RPC_URL
```

Expected:
- underwriting terms updated
- requested borrow amount becomes `0`
