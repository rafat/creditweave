# CreditWeave — Confidential AI Underwritten RWA Credit Infrastructure

CreditWeave is a privacy-first, onchain Real World Asset (RWA) lending protocol. It replaces traditional, public overcollateralization with a **Confidential Runtime Environment (CRE)** that underwrites borrowers and values assets privately, offchain, using AI and real-world data APIs.

## 🧠 Core Philosophy & Privacy-First Architecture

Traditional DeFi lending requires all data to be public onchain, which is fundamentally incompatible with institutional credit underwriting (which requires sensitive borrower financials, credit histories, and KYC data).

CreditWeave solves this by bifurcating the architecture:
**Only minimal, deterministic lending terms go onchain.** Everything else—the raw data, the API keys, and the AI reasoning—stays offchain and private within a secure enclave.

### Data Classification Model

🟢 **Onchain (Public)**
*   Asset ID
*   Decision status (approved/watchlist/denied)
*   Effective Maximum Loan-to-Value (Max LTV) in Basis Points (Bps)
*   Interest Rate (Bps) and Credit Limit
*   Expiry / review timestamps
*   `reasoningHash` (Hash of the AI's explanation)
*   Collateral amount & Borrowed amount
*   Net Asset Value (NAV)
*   Liquidations
*   Portfolio segment controls (optional, via PortfolioRiskRegistry)

🔴 **Offchain Confidential (Never touches the blockchain)**
*   Borrower income & debt-to-income ratio
*   Credit scores & past repayment history
*   KYC/AML compliance data
*   Bank transaction metadata
*   External risk signals (e.g., property ZIP codes, market trends)
*   AI's internal, plaintext reasoning and confidence scores

---

## 🏗 Full System Architecture

The system operates across three primary layers: the Frontend, the Confidential Runtime Environment (CRE), and the Smart Contracts.

```text
┌─────────────────────────────────────────────────────────┐
│                       FRONTEND                          │
│  - Borrower tokenizes real estate (Tokenization Wizard) │
│  - Borrower submits underwriting request (Asset ID)     │
│  - Prompts MetaMask to sign & send onchain tx           │
│  - Fetches and displays deep AI qualitative analysis    │
└───────────────────────────┬─────────────────────────────┘
                            │ (Onchain Event Trigger)
                            ▼
┌─────────────────────────────────────────────────────────┐
│               CRE (Confidential Runtime)                │
│                                                         │
│  1. Triggers on `UnderwritingRequested` event           │
│  2. Reads onchain state (NAV, requested amount, loc)    │
│  3. Fetches confidential HTTP data (Borrower + Asset)   │
│  4. Runs institutional cashflow-risk scoring            │
│  5. Calls LLM (Expert CRE Officer) for explanation      │
│  6. Pushes deep qualitative analysis to Private API     │
│  7. Posts V2 decision struct + provenance hash onchain  │
└───────────────────────────┬─────────────────────────────┘
                            │ (Signed EVM Report)
                            ▼
┌─────────────────────────────────────────────────────────┐
│                     Smart Contracts                     │
│  - UnderwritingRegistryV2 (Stores decision + covenants) │
│  - NAVOracle (Stores verified asset valuation)          │
│  - RWALendingPool (Executes borrows & liquidations)     │
│  - PortfolioRiskRegistry (segment-level controls)       │
│  - LossWaterfall (junior/senior loss absorption)        │
│  - RWAAssetRegistry (Lifecycle management)              │
└─────────────────────────────────────────────────────────┘
```

---

## 🛠 Implemented Features & Workflows

### 1. Smart Contracts (Solidity)
The core DeFi primitives are built to trust the CRE's outputs blindly, acting purely as enforcement mechanisms.
*   **`UnderwritingRegistryV2.sol`**: Receives signed CRE reports containing full decision payloads (`loanProduct`, `status`, `maxLtvBps`, `rateBps`, `creditLimit`, `expiry`, `covenants`, `provenance`). Uses nonce/pending request controls and emits rich `UnderwritingUpdated` events.
*   **`UnderwritingRegistry.sol`**: Legacy V1 terms registry kept for migration/backward compatibility.
*   **`NAVOracle.sol`**: Stores the Net Asset Value (NAV) of RWA collateral. Includes a `maxStaleness` mechanism. If a borrower requests a loan and the NAV is stale, the CRE will automatically compute and publish a fresh NAV before underwriting the loan.
*   **`RWALendingPool.sol`**: Core lending engine with V2 adapter support. It computes `_maxBorrowable`/`healthFactor` from underwriting + NAV and supports reserves, bad-debt accounting, and optional loss-waterfall integration.
*   **`PortfolioRiskRegistry.sol`**: Segment-level risk controls (`borrowPaused`, `ltvHaircutBps`, exposure/delinquency/watchlist thresholds). Pool can apply segment haircuts and pause borrowing by segment.
*   **`LossWaterfall.sol`**: Capital structure primitive with junior-then-senior loss absorption used when liquidations leave residual bad debt.
*   **`RWAAssetRegistry.sol`**: Manages the lifecycle of Real World Assets onchain, including registration, contract linking, and status tracking.

### 2. Confidential Runtime Environment (CRE) Workflow
The CRE (`my-workflow/main.ts`) is a secure, offchain worker powered by Chainlink's CRE SDK. It handles the heavy lifting without exposing secrets.
*   **Institutional Cashflow Underwriting Strategy**: The protocol uses a cashflow-coverage and leverage framework to score risk tiers, combining borrower quality, asset quality, and requested leverage into institutional-style credit decisions.
*   **Active AI Underwriting Agent**: The LLM (Gemini) acts as an active credit officer. It first generates a structured **Proposal JSON** (Risk Tier, LTV adjustments). This proposal is then passed through a **Deterministic Policy Gate** that enforces "tighten-only" logic and ignores low-confidence results, ensuring the AI influences terms safely.
*   **Confidential Data Aggregation**: Uses a single consolidated `/api/v1/underwriting/context` call to securely request all borrower financials and asset metrics in one snapshot.
*   **Versioned Registry Support**: Workflow supports both V1 and V2 registry modes, with V2 as the active mode on Sepolia (`UnderwritingRequested(...,uint8 triggerType)` + V2 decision report encoding).
*   **Audit Trail & Provenance**: Captures a `sourceHash` of all raw inputs used for the decision and pushes it alongside the AI analysis to the Private API, ensuring full auditability of the AI's reasoning.
*   **Dynamic NAV Computation**: If the `NAVOracle` reports a stale valuation, the CRE dynamically computes a new NAV based on real-time asset metrics (occupancy, market trends, volatility) and posts it onchain before proceeding with underwriting.
*   **Receiver-Side Verification**: After report submission, CRE verifies receiver state transitioned (request cleared) so forwarder `result=false` failures are treated as hard errors.

### 3. Private API Proxy (`private-apis/src/server.ts`)
An Express server that acts as a secure proxy between the CRE and real-world data providers.
*   **Provider-Realistic Endpoints**: Features raw vendor-like endpoints (Plaid, Experian, Onfido) and a normalized underwriting context endpoint for the CRE.
*   **Provenance & Hashing**: Every response includes `sourceVersion`, `sourceHash`, and `reportId` to support institutional audit requirements.
*   **Deterministic Scenario Generator**: Produces internally consistent borrower and asset data based on deterministic hashes, eliminating contradictory signals in mock data.
*   **Plaintext Explanation Storage**: Provides a secure endpoint for the CRE to upload deep AI qualitative analysis, which the frontend then retrieves via a hashed public endpoint.

### 4. Artifact Synchronization System (`scripts/sync-artifacts.js`)
A coordination layer that ensures all folders (contracts, frontend, cre) share the same source of truth.
*   **Automatic ABI Extraction**: Extracts clean ABIs from Foundry's build artifacts.
*   **Unified Deployment Registry**: Generates a typed `index.ts` containing deployment addresses and ABIs, making contract updates seamless across the monorepo.


### 4. Frontend Application (Next.js)
A modern dashboard for borrowers to interact with the protocol.
*   **Tokenization Wizard**: A step-by-step UI allowing borrowers to tokenize a physical property and set V2 underwriting product + optional portfolio segment at mint time. It triggers a backend Foundry script (`TokenizeAsset.s.sol`) to automate onchain setup.
*   **AI Underwriting Dashboard**: Dynamically queries the Private API for deep AI qualitative analysis and renders it with stylized confidence badges and detailed risk factor lists.
*   **Real-time Observability**: Uses `wagmi` with active blockchain polling and expanded block windows to ensure the dashboard reflects the latest onchain requests and terms.
*   **Dynamic Collateral Buffering**: Deposit helper computes product-aware safety targets (Stabilized 20%, Bridge 30%, Construction Lite 35%, +10% under watchlist/conditional or segment haircut) and uses V2 `effectiveMaxLtvBps`.

---

## 🔒 The Confidentiality Guarantee
What makes CreditWeave actually confidential?
1.  **API Keys Never Exposed**: The keys to access Gemini or real estate data providers live exclusively within the CRE secrets manager.
2.  **Borrower Data Never Exposed**: Raw JSON containing income, debt, and credit scores never touches Ethereum or any public ledger.
3.  **Summarized Output Only**: The only data that hits the chain is a binary `approved` flag, integer basis points for LTV/Rate, an expiry timestamp, and a hash.

---

## 🧭 Roadmap Progress

*   ✅ **Phase 1**: Contracts + tests (`UnderwritingRegistry`, `NAVOracle`, `RWALendingPool`)
*   ✅ **Phase 2**: Confidential Underwriting CRE workflow (institutional cashflow scoring + AI analysis)
*   ✅ **Phase 3**: Confidential NAV CRE workflow (Dynamic NAV updates within the underwriting flow)
*   ✅ **Phase 4**: Add risk monitor agent (Cron job implemented for macro-trend monitoring)
*   ✅ **Phase 5**: Frontend borrower dashboard (Built with viem/wagmi, integrates deep AI reasoning)
*   ✅ **Phase 6**: Realistic Data & Tokenization (Live Geo-API integration + Tokenization Wizard)

### Future Upgrades
*   **Encrypted Data Uploads**: Implementing the frontend logic to encrypt user financial PDFs with the CRE's public key, uploading them to IPFS, and having the CRE decrypt them internally.
*   **Dynamic Margin Calls**: Connecting the daily Risk Monitor Cron job to the `RWALendingPool` to automatically trigger liquidations or LTV reductions based on real-time macro-economic shifts.
