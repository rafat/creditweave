# CreditWeave CRE - Confidential AI Underwriting Workflow

## 🔐 Privacy-First Architecture

This CRE (Confidential Runtime Environment) workflow implements **privacy-first underwriting** for CreditWeave:

- ✅ **Borrower data NEVER touches the blockchain**
- ✅ **AI reasoning happens in confidential runtime**
- ✅ **Only cryptographically minimal outputs written onchain**
- ✅ **Verifiable but private underwriting**

---

## 📊 Data Classification

### 🟢 Onchain (Public)
Only these minimal fields are stored onchain:
- `approved` (bool)
- `maxLtvBps` (uint16)
- `rateBps` (uint16)
- `expiry` (uint256)
- `reasoningHash` (bytes32) - SHA256 hash of AI explanation

### 🔴 Offchain Confidential
All sensitive data stays in the CRE:
- Borrower income & expenses
- Credit score & history
- Debt-to-income ratio
- KYC/AML data
- Bank transaction metadata
- AI internal reasoning

---

## 🏗 Architecture Flow

```
┌─────────────────────────────────────────────┐
│                FRONTEND                    │
│  Borrower submits request + consent        │
│  requestUnderwriting(assetId)              │
└─────────────────────────────────────────────┘
                │
                │ Event Emitted
                ▼
┌─────────────────────────────────────────────┐
│           CRE (Confidential Runtime)       │
│                                             │
│  1. Listen for UnderwritingRequested event │
│  2. Read onchain state (asset data)        │
│  3. Fetch confidential HTTP data           │
│     - /api/financials/:borrowerId          │
│     - /api/credit/:borrowerId              │
│     - /api/compliance/:borrowerId          │
│  4. Call AI model (Gemini)                 │
│  5. Hash reasoning explanation             │
│  6. Post summarized result onchain         │
└─────────────────────────────────────────────┘
                │
                │ Minimal Terms Only
                ▼
┌─────────────────────────────────────────────┐
│         UnderwritingRegistry               │
│  - approved (bool)                         │
│  - maxLtvBps (uint16)                      │
│  - rateBps (uint16)                        │
│  - expiry (uint256)                        │
│  - reasoningHash (bytes32)                 │
└─────────────────────────────────────────────┘
```

---

## 🔄 Underwriting Flow

### Step 1 — Borrower Requests Underwriting
**Frontend:**
```solidity
// Borrower signs message consenting to offchain data fetch
registry.requestUnderwriting(assetId);
```

**Emits:**
```solidity
event UnderwritingRequested(
    address indexed borrower,
    uint256 indexed assetId
);
```

---

### Step 2 — CRE Confidential Execution

**CRE reads onchain:**
- Collateral value
- Asset health
- NAV data
- Past debt history

**CRE fetches confidential data via private API:**
```
GET /api/financials/:borrowerId
GET /api/credit/:borrowerId
GET /api/compliance/:borrowerId
```

**Raw JSON never leaves CRE.**

---

### Step 3 — AI Risk Scoring

**AI receives structured input:**
```json
{
  "borrowerMetrics": {
    "incomeStabilityScore": 0.82,
    "creditRiskScore": 0.73,
    "debtToIncome": 0.41,
    "pastRepaymentScore": 0.91,
    "employmentLengthMonths": 36,
    "monthlyIncome": 8000,
    "monthlyExpenses": 3200,
    "liquidAssets": 25000,
    "totalLiabilities": 45000
  },
  "assetMetrics": {
    "cashflowHealth": "PERFORMING",
    "navVolatility": 0.04,
    "rentalCoverageRatio": 1.35,
    "propertyAgeYears": 5,
    "occupancyRate": 0.95,
    "marketAppreciation1Y": 0.03
  },
  "macroContext": {
    "propertyIndexTrend": "STABLE",
    "regionalDefaultRate": 0.03,
    "interestRateEnvironment": "MODERATE",
    "unemploymentTrend": "STABLE"
  },
  "requestedLoanAmount": 700000,
  "collateralValue": 1000000
}
```

**AI outputs:**
```json
{
  "approved": true,
  "riskTier": 2,
  "maxLtvBps": 7000,
  "rateBps": 950,
  "expiry": 1712341234,
  "explanation": "Stable income, low macro risk, strong asset performance..."
}
```

---

### Step 4 — Privacy Compression

**Before posting onchain:**
1. Hash explanation → `reasoningHash = keccak256(explanation)`
2. Discard raw borrower data
3. Discard API payloads
4. Only minimal fields posted

**Onchain storage:**
```solidity
UnderwritingTerms {
    approved: true,
    maxLtvBps: 7000,
    rateBps: 950,
    expiry: 1712341234,
    reasoningHash: 0xabc123...
}
```

---

## 🛡 Confidentiality Model

### Private API Server (`private-apis/`)

The private API server acts as a **confidential data proxy**:

```typescript
// Mock borrower data (in production, fetch from real APIs)
const mockBorrowerData = {
  '0x1111...1111': {
    financials: {
      incomeStabilityScore: 0.85,
      debtToIncome: 0.35,
      averageMonthlyFreeCashFlow: 4500
    },
    credit: {
      creditRiskScore: 0.88,
      pastRepaymentScore: 0.95,
      publicBankruptcies: false
    },
    compliance: {
      kycPassed: true,
      amlFlag: false
    }
  }
};
```

**Endpoints:**
- `GET /api/financials/:borrowerId` - Banking/income data
- `GET /api/credit/:borrowerId` - Credit score & history
- `GET /api/compliance/:borrowerId` - KYC/AML status

**Authentication:**
```bash
Authorization: Bearer sk_test_12345
```

---

## 🧠 AI Design Strategy

### Hybrid Approach

Instead of full LLM dependency, we use:

1. **Deterministic scoring model** (primary)
   - Weighted risk model
   - Predictable outputs
   - Audit-friendly

2. **LLM only for explanation layer**
   - Natural language reasoning
   - Regulatory compliance
   - User-friendly explanations

**Benefits:**
- ✅ Reduces hallucination risk
- ✅ Stable rate calculations
- ✅ Lower regulatory risk
- ✅ Explainable AI decisions

---

## 📁 File Structure

```
cre/
├── my-workflow/
│   ├── main.ts              # CRE workflow implementation
│   ├── workflow.yaml        # Workflow configuration
│   ├── config.staging.json  # Staging environment config
│   ├── config.production.json # Production environment config
│   └── README.md            # This file
├── project.yaml             # CRE project settings
└── secrets.yaml             # Secrets configuration

private-apis/
├── src/
│   └── server.ts            # Confidential API proxy
├── .env                     # API keys (CRE_API_KEY, etc.)
└── package.json
```

---

## ⚙️ Configuration

### Config Fields (`config.staging.json`)

| Field | Description | Example |
|-------|-------------|---------|
| `underwritingRegistryAddress` | UnderwritingRegistry contract | `0x...` |
| `navOracleAddress` | NAVOracle contract | `0x...` |
| `rwaAssetRegistryAddress` | RWAAssetRegistry contract | `0x...` |
| `chainRpcUrl` | Sepolia RPC endpoint | `https://...` |
| `chainId` | Chain ID | `11155111` |
| `aiModelName` | Gemini model | `gemini-2.0-flash` |
| `privateApiUrl` | Private API server | `http://localhost:3001` |
| `baseRateBps` | Base interest rate | `800` (8%) |
| `rateSpreadPerRiskTier` | Rate increase per tier | `150` (1.5%) |
| `maxLtvBaseBps` | Max LTV for tier 1 | `7500` (75%) |
| `maxLtvReductionPerRiskTier` | LTV reduction per tier | `500` (5%) |

### Secrets (`secrets.yaml`)

| Secret | Description |
|--------|-------------|
| `GEMINI_API_KEY` | Google AI API key |
| `CRE_API_KEY` | Private API authentication |
| `WORKFLOW_OWNER_PRIVATE_KEY` | Transaction signing key |

---

## 🚀 Getting Started

### 1. Start Private API Server

```bash
cd private-apis
npm install
npm run dev
```

Server runs on `http://localhost:3001`

**Test:**
```bash
curl http://localhost:3001/health
```

---

### 2. Configure CRE Workflow

Update `cre/my-workflow/config.staging.json` with deployed contract addresses.

---

### 3. Set Environment Variables

Create `private-apis/.env`:
```env
PORT=3001
CRE_API_KEY=sk_test_12345
```

---

### 4. Deploy Contracts (if not done)

```bash
cd contracts
forge script script/DeployAll.s.sol:DeployAll \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast
```

---

### 5. Run CRE Workflow (Simulation)

```bash
cd cre/my-workflow
# Install dependencies
bun install

# Run simulation
cre-cli simulate \
  --target staging \
  --workflow my-workflow
```

---

## 🧪 Testing

### Test Borrower Data Fetch

```bash
# Good borrower (0x1111...1111)
curl -H "Authorization: Bearer sk_test_12345" \
  http://localhost:3001/api/financials/0x1111111111111111111111111111111111111111

# Risky borrower (0x2222...2222)
curl -H "Authorization: Bearer sk_test_12345" \
  http://localhost:3001/api/financials/0x2222222222222222222222222222222222222222
```

---

## 📊 Risk Tiers

| Tier | Risk Level | Max LTV | Rate Spread | Approval Criteria |
|------|------------|---------|-------------|-------------------|
| 1 | Lowest | 75% | Base (8%) | Excellent credit, stable income |
| 2 | Low | 70% | Base + 1.5% | Good credit, stable income |
| 3 | Medium | 65% | Base + 3% | Fair credit, moderate DTI |
| 4 | High | 60% | Base + 4.5% | Subprime, higher DTI |
| 5 | Denied | 0% | N/A | Too risky |

---

## 🔒 Security Considerations

### Private API Authentication
- All `/api/*` endpoints require Bearer token
- Token configured via `CRE_API_KEY` environment variable
- Default: `sk_test_12345` (change for production!)

### CRE Forwarder Security
- `UnderwritingRegistry` only accepts reports from Chainlink Forwarder
- Forwarder address set at contract deployment
- Additional validation via workflow ID/owner possible

### Reasoning Hash
- SHA256 hash of AI explanation stored onchain
- Allows offchain verification of AI reasoning
- Prevents tampering with decision rationale

---

## 🌐 Production Upgrades

### 1. Real Data Sources

Replace mock data with:
- **Plaid** - Banking transactions
- **Experian/TransUnion** - Credit scores
- **Onfido** - KYC/AML
- **Zillow/Redfin API** - Property values
- **FRED API** - Macro economic data

### 2. Encrypted Borrower Data Upload

```solidity
// Future: Borrower submits encrypted blob
encryptedFinancials = encrypt(userData, CRE_public_key)
```

Allows:
- Onchain storage of encrypted metadata
- Zero public exposure
- Replayable underwriting logic

### 3. AI Proxy Backend

```
CRE → Private API → LLM
```

Benefits:
- Strip identifying data before LLM
- Normalize features
- Private audit trail
- Enterprise-grade compliance

---

## 📈 Monitoring

### Key Metrics to Track

1. **Underwriting Volume**
   - Requests per day
   - Approval rate
   - Average risk tier

2. **Performance**
   - CRE execution time
   - API latency
   - AI model response time

3. **Risk Metrics**
   - Default rate by tier
   - Average LTV
   - Interest rate distribution

---

## 🐛 Troubleshooting

### CRE Workflow Not Triggering

1. Check event listener is configured correctly
2. Verify contract address in `config.staging.json`
3. Ensure CRE is connected to correct chain

### Private API Returns 401

1. Check `Authorization: Bearer` header
2. Verify `CRE_API_KEY` matches server config
3. Check for typos in borrower address

### AI Model Fails

1. Verify `GEMINI_API_KEY` is valid
2. Check API quota limits
3. Fallback to deterministic scoring

---

## 📚 Additional Resources

- [Chainlink CRE Documentation](https://docs.chain.link/chainlink-ccip)
- [Gemini AI API](https://ai.google.dev/)
- [Plaid API](https://plaid.com/docs/)
- [CreditWeave Contracts Documentation](../contracts/README.md)

---

## 🎯 Next Steps

1. ✅ Phase 1: Contracts + Tests (DONE)
2. 🔄 Phase 2: Confidential Underwriting CRE (IN PROGRESS)
3. ⏳ Phase 3: Confidential NAV CRE
4. ⏳ Phase 4: Risk Monitor Agent
5. ⏳ Phase 5: Frontend Dashboard
6. ⏳ Phase 6: AI Proxy Backend

---

**CreditWeave** - Confidential AI Underwritten RWA Credit Infrastructure
