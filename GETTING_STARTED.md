# CreditWeave Phase 2 Quick Start

This is the shortest path to run the confidential underwriting workflow end-to-end.

## 1) Build and Deploy Contracts

From the project root, you can use the unified scripts:

```bash
# 1. Build Solidity artifacts
cd contracts
forge build

# Optional Testing
forge test -vv

# 2. Deploy to Sepolia (requires env vars: SEPOLIA_RPC_URL, PRIVATE_KEY)
source.env
forge script script/DeployAll.s.sol \                                     
  --rpc-url sepolia \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify \
  --chain-id 11155111 \
  -vvvv
```

## 2) Sync Artifacts

Sync the deployment addresses and ABIs across the `frontend` and `cre` folders:

```bash
# Move back to the root folder
cd ../
npm run sync-artifacts
```

This automatically generates typed constants in both directories, so you don't need to manually update addresses.

## 3) Start Private APIs

From `private-apis/`:

Copy .env.example to .env

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

- `GEMINI_API_KEY`
- `CRE_API_KEY`
- `WORKFLOW_OWNER_PRIVATE_KEY`

## 5) Typecheck Workflow

From `cre/my-workflow/`:

```bash
bun x tsc --noEmit
```

## 6) Trigger Underwriting Request

Current contract call (Note: the event now includes a **nonce** for security):

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
UnderwritingRequested(address borrower, uint256 assetId, uint256 intendedBorrowAmount, uint64 nonce)
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
