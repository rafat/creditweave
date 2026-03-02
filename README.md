# CreditWeave

CreditWeave is a privacy-first RWA lending protocol where confidential underwriting runs in Chainlink CRE and only deterministic lending outputs are enforced onchain.

## What It Solves

Traditional DeFi underwriting is public-by-default and cannot safely handle institutional borrower data (income, credit, KYC/AML context).  
CreditWeave separates:

- **Private decisioning in CRE**
- **Public enforcement in smart contracts**

## Monorepo Structure

- `contracts/`: Solidity contracts, Foundry tests, deployment scripts
- `cre/`: CRE project, workflow runtime config, secrets wiring
- `private-apis/`: Confidential data + explanation API used by CRE/frontend
- `frontend/`: Next.js app for borrower/admin/investor flows
- `scripts/sync-artifacts.js`: Syncs deployed addresses + ABIs into frontend/CRE

## Core Onchain Components

- `UnderwritingRegistryV2`: decision/status/terms/covenants/provenance storage
- `NAVOracle`: NAV feed with staleness checks
- `RWALendingPool`: collateral, borrow, repay, liquidate, reserves/loss accounting
- `RWAAssetRegistry`: asset lifecycle and compliance controls
- `PortfolioRiskRegistry`: segment-level haircuts/pauses/thresholds
- `LossWaterfall`: junior/senior loss absorption

Legacy `UnderwritingRegistry` is retained for compatibility.

## End-to-End Flow

1. Borrower tokenizes an asset in frontend (`TokenizationWizard`).
   - A fixed-supply ERC20 property share token is minted to the originator wallet.
2. Borrower submits underwriting request onchain.
3. CRE trigger processes request privately and computes terms.
4. CRE posts signed V2 report onchain.
5. Frontend shows underwriting status + private explanation by hash.
6. Borrower deposits collateral, borrows, repays, and withdraws.

## Quickstart

** Important ** The Demo workflow requires that you use the same ethereum private key throughout as deployment sets
the different permissions to the same deployment address. These addresses can be individually changed by calling the
contracts but to simplify the demo workflow it is much easier to use the same wallet and therefore the same key throughout. 

### 1) Install dependencies

```bash
# root
npm install

# frontend
cd frontend && npm install

# private API
cd ../private-apis && npm install
```

### 2) Build/test contracts

copy .env.example to .env
 and add private key, sepolia rpc url etc.
```
SEPOLIA_FORWARDER=0x15fC6ae953E024d975e77382eEeC56A9101f9F88
PRIVATE_KEY=
SEPOLIA_RPC=
ETHERSCAN_API_KEY=
```

```bash
cd contracts
source .env
forge build
forge test -vv
```

### 3) Deploy contracts (Sepolia)

```bash
cd contracts
forge script script/DeployAll.s.sol --rpc-url sepolia --private-key $PRIVATE_KEY --broadcast --verify --chain-id 11155111 -vvvv
```

### 4) Sync ABIs + addresses

```bash
cd ..
npm run sync-artifacts
```

### 5) Run app stack
private-apis folder : copy .env.example to .env

```
CRE_API_KEY=sk_test_12345
PORT=3001
RENTCAST_API_KEY=
```
use the default values for the first two. RENTCAST_API_KEY is optional but recommended to get finegrained data for US real estate properties.


frontend folder  : copy .env.example to .env

```
NEXT_PUBLIC_SEPOLIA_RPC_URL=
NEXT_PUBLIC_PRIVATE_API_URL=http://localhost:3001
ADMIN_PRIVATE_KEY=
```
Add your ethereum private key and sepolia url


cre folder : copy env.example to .env

```
###############################################################################
### REQUIRED ENVIRONMENT VARIABLES - SENSITIVE INFORMATION                  ###
### DO NOT STORE RAW SECRETS HERE IN PLAINTEXT IF AVOIDABLE                 ###
### DO NOT UPLOAD OR SHARE THIS FILE UNDER ANY CIRCUMSTANCES                ###
###############################################################################
# Ethereum private key or 1Password reference (e.g. op://vault/item/field)
CRE_ETH_PRIVATE_KEY=

# Default target used when --target flag is not specified (e.g. staging-settings, production-settings, my-target)
CRE_TARGET=staging-settings
# Gemini API Key
GEMINI_API_KEY_ALL=

###############################################################################
CRE_API_KEY_ALL=sk_test_12345
WORKFLOW_OWNER_PRIVATE_KEY_ALL=
```
All values are needed. Your private key should be the same for all these folders corrsponding to the wallet address that
is deploying the contracts.


```bash
# terminal 1
cd private-apis
npm install
npm run dev

# terminal 2
cd frontend
npm install
npm run dev

# terminal 3 (optional CRE simulation) Check demo to see how CRE workflow is utilized
cd cre
cre workflow simulate ./my-workflow -T staging-settings --broadcast
```

## Key Documentation

- System architecture: `Architecture.md`
- Contracts details: `contracts/README.md`
- CRE overview: `cre/README.md`
- Workflow internals: `cre/my-workflow/README.md`

