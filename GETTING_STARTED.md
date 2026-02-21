# 🚀 CreditWeave Phase 2 - Quick Start Guide

This guide walks you through setting up and testing the **Confidential AI Underwriting CRE Workflow**.

---

## 📋 Prerequisites

- **Node.js** v18+ and **Bun** installed
- **Foundry** for contract deployment
- **Google AI API Key** (for Gemini)
- **Sepolia RPC URL** (e.g., from Alchemy/Infura)

---

## 🏗️ Architecture Overview

```
┌──────────────┐      ┌─────────────────────┐      ┌──────────────────┐
│   Frontend   │ ───► │  CRE Workflow       │ ───► │  Smart Contracts │
│              │      │  (Confidential)     │      │                  │
│ - Request    │      │  - Fetch private    │      │  - Underwriting  │
│   Underwrite │      │    data             │      │    Registry      │
│              │      │  - Run AI model     │      │  - Lending Pool  │
│              │      │  - Hash reasoning   │      │                  │
└──────────────┘      └─────────────────────┘      └──────────────────┘
                              │
                              ▼
                     ┌──────────────────┐
                     │  Private APIs    │
                     │  (Mock Data)     │
                     │  - Financials    │
                     │  - Credit        │
                     │  - Compliance    │
                     └──────────────────┘
```

---

## Step-by-Step Setup

### Step 1: Deploy Smart Contracts

```bash
cd contracts

# Install dependencies
forge install

# Deploy everything (make sure PRIVATE_KEY and RPC_URL are set)
forge script script/DeployAll.s.sol:DeployAll \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify
```

**Save the deployed addresses!** You'll need them for CRE config.

---

### Step 2: Start Private API Server

```bash
cd private-apis

# Install dependencies
npm install

# Copy example env
cp .env.example .env

# Edit .env and set your API key
# CRE_API_KEY=sk_test_12345

# Start server
npm run dev
```

**Test it's working:**
```bash
curl http://localhost:3001/health
# Should return: {"status":"ok","service":"CreditWeave Private API Proxy"}
```

**Test borrower data endpoints:**
```bash
# Good borrower (0x1111...1111)
curl -H "Authorization: Bearer sk_test_12345" \
  http://localhost:3001/api/financials/0x1111111111111111111111111111111111111111

# Risky borrower (0x2222...2222)
curl -H "Authorization: Bearer sk_test_12345" \
  http://localhost:3001/api/financials/0x2222222222222222222222222222222222222222
```

---

### Step 3: Configure CRE Workflow

Edit `cre/my-workflow/config.staging.json`:

```json
{
  "underwritingRegistryAddress": "0xYOUR_DEPLOYED_ADDRESS",
  "navOracleAddress": "0xYOUR_DEPLOYED_ADDRESS",
  "lendingPoolAddress": "0xYOUR_DEPLOYED_ADDRESS",
  "rwaAssetRegistryAddress": "0xYOUR_DEPLOYED_ADDRESS",
  "chainRpcUrl": "https://ethereum-sepolia-rpc.publicnode.com",
  "chainId": 11155111,
  "aiModelName": "gemini-2.0-flash",
  "privateApiUrl": "http://localhost:3001",
  "baseRateBps": 800,
  "rateSpreadPerRiskTier": 150,
  "maxLtvBaseBps": 7500,
  "maxLtvReductionPerRiskTier": 500
}
```

---

### Step 4: Set CRE Secrets

Create or edit `cre/.env` (or use the secrets manager):

```bash
# Gemini API Key
GEMINI_API_KEY=your_gemini_api_key_here

# Private API Key (must match private-apis/.env)
CRE_API_KEY=sk_test_12345

# Workflow owner private key
WORKFLOW_OWNER_PRIVATE_KEY=your_workflow_key_here
```

---

### Step 5: Test CRE Workflow Simulation

```bash
cd cre/my-workflow

# Install dependencies (if not done)
bun install

# Run simulation
cre-cli simulate \
  --target staging \
  --workflow my-workflow
```

---

### Step 6: Trigger Underwriting Request

In your frontend or via cast:

```bash
# Call requestUnderwriting on the contract
cast send \
  $UNDERWRITING_REGISTRY_ADDRESS \
  "requestUnderwriting(uint256)" \
  1 \
  --private-key $PRIVATE_KEY \
  --rpc-url $SEPOLIA_RPC_URL
```

This emits the `UnderwritingRequested` event that triggers the CRE workflow.

---

## 🧪 Testing Scenarios

### Scenario 1: Good Borrower (0x1111...1111)

**Expected Output:**
- ✅ Approved: `true`
- ✅ Risk Tier: `1` or `2`
- ✅ Max LTV: `7000-7500 bps` (70-75%)
- ✅ Rate: `800-950 bps` (8-9.5%)

**Test:**
```bash
# Simulate with good borrower
cast send \
  $UNDERWRITING_REGISTRY_ADDRESS \
  "requestUnderwriting(uint256)" \
  1 \
  --from 0x1111111111111111111111111111111111111111 \
  --private-key $PRIVATE_KEY
```

---

### Scenario 2: Risky Borrower (0x2222...2222)

**Expected Output:**
- ❌ Approved: `false` (or tier 4-5)
- ❌ Risk Tier: `4` or `5`
- ❌ Max LTV: `6000-6500 bps` (60-65%) or `0`
- ❌ Rate: `1100+ bps` (11%+)

**Test:**
```bash
# Simulate with risky borrower
cast send \
  $UNDERWRITING_REGISTRY_ADDRESS \
  "requestUnderwriting(uint256)" \
  1 \
  --from 0x2222222222222222222222222222222222222222 \
  --private-key $PRIVATE_KEY
```

---

## 📊 Verify Results

After CRE processes the request, check onchain data:

```bash
# Get underwriting terms
cast call \
  $UNDERWRITING_REGISTRY_ADDRESS \
  "getTerms(address,uint256)" \
  0x1111111111111111111111111111111111111111 \
  1
```

**Expected output (tuple):**
```
approved: true
maxLtvBps: 7000
rateBps: 950
expiry: <timestamp>
reasoningHash: 0x...
```

---

## 🐛 Troubleshooting

### Private API Returns 401 Unauthorized

**Problem:** API key mismatch

**Solution:**
1. Check `private-apis/.env` has `CRE_API_KEY=sk_test_12345`
2. Check CRE request includes `Authorization: Bearer sk_test_12345`
3. Restart private-apis server

### CRE Workflow Not Triggering

**Problem:** Event listener not configured

**Solution:**
1. Verify contract address in `config.staging.json`
2. Check CRE is connected to correct chain (Sepolia)
3. Ensure event signature matches: `UnderwritingRequested(address,uint256)`

### AI Model Fails

**Problem:** Gemini API key invalid or quota exceeded

**Solution:**
1. Check `GEMINI_API_KEY` in secrets
2. Verify API key at https://aistudio.google.com/apikey
3. Workflow will fallback to deterministic scoring

### Contract Reverts on Report

**Problem:** Invalid report encoding

**Solution:**
1. Check `encodeAbiTerms` function matches contract's expected format
2. Verify expiry is in the future: `expiry > block.timestamp`
3. Verify LTV is valid: `maxLtvBps <= 10_000`

---

## 📈 Next Steps

After getting the basic flow working:

1. **Add Real Data Sources**
   - Integrate Plaid for real banking data
   - Connect credit score APIs
   - Add property valuation APIs

2. **Enhance Privacy**
   - Add encrypted borrower data uploads
   - Implement zero-knowledge proofs
   - Build AI proxy backend

3. **Build Frontend**
   - Borrower dashboard
   - Investor dashboard
   - Admin panel for risk monitoring

4. **Deploy to Production**
   - Update config for mainnet
   - Set up monitoring
   - Configure proper access controls

---

## 📚 Additional Resources

- [CRE Workflow README](./cre/my-workflow/README.md)
- [Contracts Documentation](./contracts/README.md)
- [Private APIs Source](./private-apis/src/server.ts)
- [Chainlink CRE Docs](https://docs.chain.link/)

---

**🎉 You're ready to build confidential AI underwriting!**
