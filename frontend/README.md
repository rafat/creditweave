# CreditWeave Frontend

Next.js app for the borrower, investor, and admin dashboards.

## Routes

- `/borrower`: Tokenization wizard + underwriting request + borrow flow
- `/investor`: pool and asset observability
- `/admin`: chain, API, and CRE signal health

## Tokenization Wizard

The Borrower dashboard includes a **Step 1: Tokenize Property** wizard.
- **Functionality**: Users input a real-world address and property value.
- **Backend**: The `/api/rpc/tokenize` route executes the `contracts/script/TokenizeAsset.s.sol` Foundry script.
- **Result**: Automates asset registration, contract deployment (Logic, Vault, Token), linking, and minting of 10,000 shares to the user's wallet.

## Environment

Copy `.env.example` to `.env.local` and set values:

```bash
cp .env.example .env.local
```

Required public variables:

- `NEXT_PUBLIC_UNDERWRITING_REGISTRY`
- `NEXT_PUBLIC_UNDERWRITING_REGISTRY_V2` (optional; when set, frontend uses V2 underwriting reads/events)
- `NEXT_PUBLIC_NAV_ORACLE`
- `NEXT_PUBLIC_LENDING_POOL`
- `NEXT_PUBLIC_RWA_ASSET_REGISTRY`
- `NEXT_PUBLIC_PRIVATE_API_URL`

Required server-side variables (for `/api/rpc/tokenize`):

- `ADMIN_PRIVATE_KEY`: Private key with permissions to register and activate assets.
- `SEPOLIA_RPC_URL`: RPC URL for Foundry script execution.

RPC configuration:

- `SEPOLIA_RPC_URL` (recommended): used by server-side `/api/rpc` proxy, avoids browser CORS and keeps provider key private.
- `NEXT_PUBLIC_SEPOLIA_RPC_URL`: no longer used by app transport (kept intentionally disabled to avoid CORS failures).

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Quality Gates

Run before each merge/demo:

```bash
npm run lint
npx tsc --noEmit
```

Or run both at once:

```bash
npm run check
```

## CI

GitHub Actions workflow: `.github/workflows/frontend-ci.yml`

It runs on frontend changes and enforces:

1. `npm run check`
2. `npm run build`

## Demo QA Checklist (Item 11)

1. Wallet connects in MetaMask and shows Sepolia chain id `11155111`.
2. Wrong-network guard appears and switch action works.
3. Borrower page submits `requestUnderwriting(assetId, intendedBorrowAmount)`.
4. Borrower status card refreshes pending amount and terms after confirmation.
5. Borrow action is blocked when terms are expired, NAV is stale, or approval is false.
6. Borrow action succeeds for valid terms and amount.
7. Investor page loads pool, asset, and recent underwriting outcomes.
8. Admin page shows chain health, private API health, and CRE event signal.
9. No console runtime errors during common flows.
