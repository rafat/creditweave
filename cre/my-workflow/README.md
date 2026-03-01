# CreditWeave CRE Underwriting Workflow

Privacy-first institutional underwriting workflow for CreditWeave.

## What This Workflow Does

1. Listens to `UnderwritingRequested` events on `UnderwritingRegistry`.
2. Reads onchain context:
   - `RWAAssetRegistry.getAssetCore(assetId)`
   - `RWAAssetRegistry.getAssetMetadata(assetId)` (retrieves property physical address)
   - `NAVOracle.isFresh(assetId)` and `NAVOracle.getNAVData(assetId)`
   - `UnderwritingRegistry.getRequestedBorrowAmount(borrower, assetId)`
3. Fetches confidential borrower and asset data from consolidated private APIs:
   - `/api/borrower-data/:borrower` (aggregate financials, credit, compliance)
   - `/api/assets/:assetId?address=...` (live geographic property data)
4. Runs institutional **DSCR (Debt Service Coverage Ratio)** underwriting policy.
5. Runs Gemini (Expert CRE Credit Officer) for deep qualitative qualitative analysis.
6. Hashes analysis JSON and writes minimal terms onchain.

## Institutional Risk Model

Deterministic logic computes binding terms using CRE industry standards:
- **DSCR is King**: Base Risk Tier is determined by `Rental Income / Debt Payment`.
- **Borrower Health**: Credit score and DTI are used as secondary qualifying factors.
- **Risk Tiers**:
  - Tier 1 (Prime): DSCR >= 1.5
  - Tier 2 (Standard): DSCR >= 1.25
  - Tier 3 (Watch): DSCR >= 1.1
  - Tier 4 (Substandard): DSCR >= 1.0
  - Tier 5 (Default Risk): DSCR < 1.0
- **Dynamic Modifiers**:
  - NAV volatility stress bump (`navVolatility > 0.08` => tier +1)
  - Macro `HIGH` rate environment: `rateBps + 100`
  - Macro `DECLINING` property trend: `maxLtvBps - 500`

## AI Qualitative Analysis Layer

Gemini acts as an **Expert CRE Credit Officer**, providing a deep qualitative assessment.

Expected explanation JSON:

```json
{
  "summary": "string",
  "keyRisks": ["string"],
  "confidenceLevel": "LOW | MEDIUM | HIGH",
  "riskFlags": ["string"]
}
```

## Safety Gates Implemented

- Asset status deny list (`DEFAULTED`, `LIQUIDATING`, `PAUSED`)
- NAV freshness / non-zero NAV enforcement
- Compliance hard-denies (KYC/AML flags)
- DSCR minimum threshold enforcement

## Workflow Config & Limits

The workflow is optimized to run with fewer than 5 HTTP calls by using consolidated API endpoints, remaining within CRE capability limits.

Required secrets in `cre/secrets.yaml`:
- `GEMINI_API_KEY`: For Expert AI analysis
- `CRE_API_KEY`: For authenticated Private API access
- `WORKFLOW_OWNER_PRIVATE_KEY`: For signing onchain reports

## Registry Version Compatibility

Set `underwritingRegistryVersion` in `config.staging.json` / `config.production.json`:

- `"v1"`: uses legacy report shape (`approved`, `maxLtvBps`, `rateBps`, `creditLimit`, `expiry`, `reasoningHash`)
- `"v2"`: uses `UnderwritingDecision` struct report shape (loan product, status, covenants, provenance)

Event trigger signatures are selected automatically by this setting:

- V1: `UnderwritingRequested(address,uint256,uint256,uint64)`
- V2: `UnderwritingRequested(address,uint256,uint256,uint64,uint8)`

## Local Run

1. Start private API server:
```bash
cd private-apis
npm run dev
```

2. Simulate workflow:
```bash
cd cre
cre workflow simulate ./my-workflow -T staging-settings
```
