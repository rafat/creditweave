# CreditWeave CRE (Centerpiece)

This folder contains the Chainlink Confidential Runtime Environment (CRE) workflow that powers CreditWeave underwriting.

CRE is the decision engine of the protocol:
- it ingests confidential borrower/asset context,
- computes underwriting terms and risk state,
- and writes only deterministic outputs onchain.

## Why CRE Is The Centerpiece

The smart contracts are enforcement rails. CRE is where real underwriting happens.

- Offchain/private in CRE:
  - borrower financials and credit profile
  - KYC/AML/compliance context
  - model/provider keys
  - AI qualitative reasoning payload
- Onchain/public:
  - decision status and terms
  - credit limit/LTV/rate/expiry
  - reasoning hash and provenance hashes
  - liquidation/accounting state

## Current Active Mode (Sepolia)

- Underwriting registry mode: `v2`
- Registry address comes from `contracts/deployments.json` via sync
- Config keys:
  - `underwritingRegistryAddress`
  - `underwritingRegistryVersion: "v2"`
  - `gasLimit: "1200000"` (increased for V2 report complexity)

Files:
- Workflow logic: `cre/my-workflow/main.ts`
- Workflow config: `cre/my-workflow/config.staging.json`, `config.production.json`
- Workflow runtime settings: `cre/my-workflow/workflow.yaml`
- Secrets path: `cre/secrets.yaml`

## End-to-End Underwriting Flow

1. Borrower submits `requestUnderwriting(assetId, intendedBorrowAmount)` onchain.
2. `UnderwritingRegistryV2` emits `UnderwritingRequested(address,uint256,uint256,uint64,uint8)`.
3. CRE trigger catches the event and decodes borrower/asset/request context.
4. CRE reads onchain context:
   - asset status from `RWAAssetRegistry`
   - NAV freshness/value from `NAVOracle`
   - request context from `UnderwritingRegistryV2.getRequestContext(...)`
5. CRE performs one confidential aggregate call to private APIs:
   - borrower financial+credit+compliance
   - asset metrics and macro context
6. CRE runs deterministic underwriting + policy gates (DSCR/risk tier logic).
7. CRE generates AI qualitative analysis and stores plaintext explanation in private API.
8. CRE encodes a V2 `UnderwritingDecision` report and sends via forwarder.
9. `UnderwritingRegistryV2.onReport(...)` validates/stores decision and clears pending request.
10. Frontend renders onchain terms + private explanation by `reasoningHash`.

## Important Safety Behavior

CRE now verifies receiver-side state transition after report submission:
- V2: re-reads `getRequestContext(...)` and requires `pending == false` and `intendedBorrowAmount == 0`
- If not, workflow throws hard failure.

Reason: forwarder tx can succeed while receiver processing fails (`result=false`), e.g. if gas is too low.

## Runbook (Local / Demo)

1. Start private API:

```bash
cd private-apis
npm run dev
```

2. Ensure latest deployed addresses/ABIs are synced:

```bash
cd ..
npm run sync-artifacts
```

3. Simulate + broadcast CRE workflow:

```bash
cd cre
cre workflow simulate ./my-workflow -T staging-settings --broadcast
```

4. Verify success onchain:
- `UnderwritingUpdated` emitted
- `getRequestContext(borrower, assetId).pending == false`
- `getBorrowingTerms(...)` reflects expected values

## Contract Compatibility (What CRE Expects)

- Receiver: `UnderwritingRegistryV2`
- Trigger signature (v2):
  - `UnderwritingRequested(address,uint256,uint256,uint64,uint8)`
- Read shape:
  - `getRequestContext(address,uint256)`
- Report shape:
  - V2 decision struct (loan product, status, covenants, provenance)

## Common Failure Modes

1. Request remains pending after "successful" workflow log
- Cause: receiver processing failed inside forwarder path (often gas).
- Fix: increase `gasLimit` and re-run; current default is `1200000`.

2. No trigger fired
- Cause: wrong registry address/version or wrong event signature.
- Fix: confirm config has V2 address and `underwritingRegistryVersion: "v2"`.

3. `onReport` auth failures (`InvalidSender`, workflow mismatch)
- Cause: receiver forwarder/workflow identity constraints mismatch.
- Fix: verify receiver settings in `ReceiverTemplate` fields.

## Related Docs

- Detailed workflow internals: `cre/my-workflow/README.md`
- System-level architecture: `Architecture.md`
- Contract deployment/wiring: `contracts/README.md`
