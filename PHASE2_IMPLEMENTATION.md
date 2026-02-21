# Phase 2 Implementation Status

## Scope

Phase 2 = confidential CRE underwriting workflow wired to deployed contracts and private APIs.

## Implemented

### Contracts + Flow Integration
- `UnderwritingRegistry` request flow includes intended borrow amount:
  - `requestUnderwriting(uint256 assetId, uint256 intendedBorrowAmount)`
  - event: `UnderwritingRequested(address,uint256,uint256)`
- CRE listens to that event and writes report terms back through forwarder path.

### CRE Workflow (`cre/my-workflow/main.ts`)
- Onchain reads:
  - `RWAAssetRegistry.getAssetCore`
  - `NAVOracle.isFresh`
  - `NAVOracle.getNAVData`
  - `UnderwritingRegistry.getRequestedBorrowAmount`
- Confidential borrower context fetch:
  - `/api/financials/:borrower`
  - `/api/credit/:borrower`
  - `/api/compliance/:borrower`
- Safety gates:
  - hard deny on bad asset statuses
  - hard deny on stale/missing NAV
  - skip processing if no pending requested borrow amount
  - skip processing on event/request mismatch
  - deny when requested amount exceeds computed max borrow from terms
- Replay handling:
  - in-process request dedupe set
  - pending-request check prevents stale reprocessing after request is cleared

### Risk Model
- Deterministic model is binding (`approved`, `maxLtvBps`, `rateBps`, `expiry`)
- Cashflow health scoring is dynamic (`PERFORMING`, `GRACE_PERIOD`, `LATE`, `DEFAULTED`)
- Macro modifiers:
  - `HIGH` interest environment: `rateBps + 100`
  - `DECLINING` property trend: `maxLtvBps - 500`
- NAV volatility stress test:
  - if `navVolatility > 0.1`, bump risk tier by 1

### AI Explanation Layer
- Gemini is used for explanation JSON only (non-binding).
- Output shape:
  - `summary`
  - `keyRisks`
  - `confidenceLevel`
  - `riskFlags`
- Fallback explanation path exists if Gemini call/parsing fails.

### Privacy Compression
- Only minimal terms are posted onchain.
- Explanation is hashed with UTF-8 safe keccak:
  - `keccak256(toHex(new TextEncoder().encode(explanationJsonString)))`

### Docs/Config Alignment
- `cre/my-workflow/README.md` updated to current behavior.
- `GETTING_STARTED.md` updated to current deployment/simulation path.
- CRE config files updated with latest deployed addresses.

## Secrets Model (Current)

`cre/secrets.yaml` mappings:
- `GEMINI_API_KEY` -> `GEMINI_API_KEY_ALL`
- `CRE_API_KEY` -> `CRE_API_KEY_ALL`
- `WORKFLOW_OWNER_PRIVATE_KEY` -> `WORKFLOW_OWNER_PRIVATE_KEY_ALL`

## Remaining Work for Phase 2 Exit

1. Run full Sepolia event-triggered simulation against latest deployment and capture proof logs/tx links.
2. Add a short verification script/checklist for:
   - `getTerms` updated
   - `getRequestedBorrowAmount` cleared
   - borrow path respects approval/expiry
3. Lock demo borrower scenarios and expected outputs for pitch repeatability.
