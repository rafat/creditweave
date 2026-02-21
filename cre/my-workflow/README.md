# CreditWeave CRE Underwriting Workflow

Privacy-first underwriting workflow for CreditWeave phase 2.

## What This Workflow Does

1. Listens to `UnderwritingRequested` events on `UnderwritingRegistry`.
2. Reads onchain context:
   - `RWAAssetRegistry.getAssetCore(assetId)`
   - `NAVOracle.isFresh(assetId)` and `NAVOracle.getNAVData(assetId)`
   - `UnderwritingRegistry.getRequestedBorrowAmount(borrower, assetId)`
3. Fetches confidential borrower data from private APIs:
   - `/api/financials/:borrower`
   - `/api/credit/:borrower`
   - `/api/compliance/:borrower`
4. Runs deterministic underwriting policy (binding terms).
5. Runs Gemini only for explanation memo (non-binding).
6. Hashes explanation JSON with UTF-8 safe keccak256 and writes minimal terms onchain.

Only minimal terms are posted onchain:
- `approved`
- `maxLtvBps`
- `rateBps`
- `expiry`
- `reasoningHash`

## Current Event + Request Flow

Borrower request:

```solidity
requestUnderwriting(uint256 assetId, uint256 intendedBorrowAmount)
```

Observed event:

```solidity
event UnderwritingRequested(
  address indexed borrower,
  uint256 indexed assetId,
  uint256 intendedBorrowAmount
);
```

Workflow uses the registry pending value as source of truth:
- If pending requested amount is `0`, it skips processing.
- If event intended amount mismatches registry pending value, it skips processing.
- This prevents stale/replayed events from re-underwriting cleared requests.

## Safety Gates Implemented

- Asset status deny list (`DEFAULTED`, `LIQUIDATING`, `PAUSED`)
- NAV freshness / non-zero NAV enforcement
- Requested amount must be present and consistent
- Requested LTV must be within computed max LTV
- Compliance hard-denies:
  - KYC not passed
  - AML flagged
  - Public bankruptcy present

## Deterministic Risk Model

Deterministic logic computes binding terms:
- `riskTier`
- `maxLtvBps`
- `rateBps`
- `approved`

Enhancements included:
- Cashflow health scoring (`PERFORMING/GRACE_PERIOD/LATE/DEFAULTED`)
- Macro modifiers:
  - `HIGH` rate environment: `rateBps + 100`
  - `DECLINING` property trend: `maxLtvBps - 500`
- NAV volatility stress bump (`navVolatility > 0.1` => tier +1)

## AI Explanation Layer

Gemini is used only for explanation JSON, not for binding terms.

Expected explanation JSON:

```json
{
  "summary": "string",
  "keyRisks": ["string"],
  "confidenceLevel": "LOW | MEDIUM | HIGH",
  "riskFlags": ["string"]
}
```

Onchain hash strategy:

```ts
reasoningHash = keccak256(toHex(new TextEncoder().encode(JSON.stringify(explanation))))
```

## Config

Workflow config files:
- `config.staging.json`
- `config.production.json`

Required fields:
- `underwritingRegistryAddress`
- `navOracleAddress`
- `lendingPoolAddress`
- `rwaAssetRegistryAddress`
- `chainSelectorName` (Sepolia selector name)
- `privateApiUrl`
- `aiModelName` (for Gemini)
- `baseRateBps`
- `rateSpreadPerRiskTier`
- `maxLtvBaseBps`
- `maxLtvReductionPerRiskTier`
- `gasLimit`

## Secrets

`cre/secrets.yaml` maps:
- `GEMINI_API_KEY` -> `GEMINI_API_KEY_ALL`
- `CRE_API_KEY` -> `CRE_API_KEY_ALL`
- `WORKFLOW_OWNER_PRIVATE_KEY` -> `WORKFLOW_OWNER_PRIVATE_KEY_ALL`

Workflow runtime reads:
- `CRE_API_KEY` for private APIs
- `GEMINI_API_KEY` for explanation generation

## Local Run

1. Start private API server:

```bash
cd private-apis
npm install
npm run dev
```

2. Compile type check:

```bash
cd cre/my-workflow
bun x tsc --noEmit
```

3. Simulate workflow:

```bash
cd cre
cre workflow simulate ./my-workflow -T staging-settings
```

For event-trigger simulation, provide:
- tx hash containing `UnderwritingRequested`
- event index for that log

## Notes

- This workflow is designed for confidential underwriting, not public data disclosure.
- Deterministic engine is the source of truth for credit terms.
- LLM output is explanatory only.
