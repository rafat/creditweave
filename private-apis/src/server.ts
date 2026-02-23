import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;
const strictUnknownBorrowers = process.env.STRICT_UNKNOWN_BORROWERS !== 'false';

// Middleware
app.use(cors());
app.use(express.json());

// --------------------------------------------------------------------------
// AUTHENTICATION MIDDLEWARE
// --------------------------------------------------------------------------
// Enforces that only callers (CRE) with the correct Bearer token can access
const authenticate = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    const expectedToken = process.env.CRE_API_KEY;

    if (!expectedToken) {
        res.status(500).json({ error: 'CRE_API_KEY is not configured on server' });
        return;
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or malformed Authorization header' });
        return;
    }

    const token = authHeader.split(' ')[1];
    if (token !== expectedToken) {
        res.status(403).json({ error: 'Invalid API Key' });
        return;
    }

    next();
};

// --------------------------------------------------------------------------
// MOCK IN-MEMORY STATE FOR DEMOS
// --------------------------------------------------------------------------
// You can easily change this object mid-demo without a database
const mockBorrowerData: Record<string, any> = {
    '0x1111111111111111111111111111111111111111': {
        // Mock Plaid / Financial Data
        financials: {
            incomeStabilityScore: 0.85,
            debtToIncome: 0.35,
            averageMonthlyFreeCashFlow: 4500
        },
        // Mock Experian / Credit Data
        credit: {
            creditRiskScore: 0.88,
            pastRepaymentScore: 0.95,
            publicBankruptcies: false
        },
        // Mock Onfido / KYC Data
        compliance: {
            kycPassed: true,
            amlFlag: false
        }
    },
    '0x2222222222222222222222222222222222222222': {
        financials: {
            incomeStabilityScore: 0.40,
            debtToIncome: 0.65,
            averageMonthlyFreeCashFlow: 500
        },
        credit: {
            creditRiskScore: 0.55,
            pastRepaymentScore: 0.60,
            publicBankruptcies: true
        },
        compliance: {
            kycPassed: true,
            amlFlag: false
        }
    }
};

const mockAssetData: Record<string, any> = {
    '1': {
        cashflowHealth: "PERFORMING",
        navVolatility: 0.04,
        rentalCoverageRatio: 1.35,
        propertyAgeYears: 5,
        occupancyRate: 0.95,
        marketAppreciation1Y: 0.03,
        zipCode: "90210",
        address: "123 Beverly Hills Drive"
    },
    '2': {
        cashflowHealth: "GRACE_PERIOD",
        navVolatility: 0.08,
        rentalCoverageRatio: 1.05,
        propertyAgeYears: 20,
        occupancyRate: 0.80,
        marketAppreciation1Y: -0.01,
        zipCode: "10001",
        address: "456 Manhattan Ave"
    }
};

const mockExplanations: Record<string, any> = {};

// Public endpoint for frontend to fetch AI explanations
app.get('/frontend/explanations/:hash', (req: Request, res: Response): void => {
    const { hash } = req.params;
    const normalizedHash = Array.isArray(hash) ? hash[0] : hash;
    const explanation = mockExplanations[normalizedHash];
    if (!explanation) {
        res.status(404).json({ error: 'Explanation not found' });
        return;
    }
    res.json(explanation);
});

// Apply auth middleware to all /api routes
app.use('/api', authenticate);

// --------------------------------------------------------------------------
// CONFIDENTIAL ENDPOINTS
// --------------------------------------------------------------------------

// 1. Financials Endpoint
app.get('/api/financials/:borrowerId', (req: Request, res: Response): void => {
    const { borrowerId } = req.params;
    const normalizedId = Array.isArray(borrowerId) ? borrowerId[0] : borrowerId;
    const data = mockBorrowerData[normalizedId.toLowerCase()];

    if (!data) {
        // Conservative baseline for unknown borrowers
        res.json({
            incomeStabilityScore: 0.55,
            debtToIncome: 0.58,
            averageMonthlyFreeCashFlow: 1200
        });
        return;
    }

    res.json(data.financials);
});

// 2. Credit Endpoint
app.get('/api/credit/:borrowerId', (req: Request, res: Response): void => {
    const { borrowerId } = req.params;
    const normalizedId = Array.isArray(borrowerId) ? borrowerId[0] : borrowerId;
    const data = mockBorrowerData[normalizedId.toLowerCase()];

    if (!data) {
        // Conservative baseline for unknown borrowers
        res.json({
            creditRiskScore: 0.52,
            pastRepaymentScore: 0.58,
            publicBankruptcies: true
        });
        return;
    }

    res.json(data.credit);
});

// 3. Compliance Endpoint
app.get('/api/compliance/:borrowerId', (req: Request, res: Response): void => {
    const { borrowerId } = req.params;
    const normalizedId = Array.isArray(borrowerId) ? borrowerId[0] : borrowerId;
    const data = mockBorrowerData[normalizedId.toLowerCase()];

    if (!data) {
        // Fail-closed by default for unknown borrower profiles
        if (strictUnknownBorrowers) {
            res.json({
                kycPassed: false,
                amlFlag: true,
                reason: 'PROFILE_NOT_FOUND'
            });
            return;
        }

        res.json({
            kycPassed: true,
            amlFlag: false
        });
        return;
    }

    res.json(data.compliance);
});

// Aggregate endpoint to reduce CRE API calls
app.get('/api/borrower-data/:borrowerId', (req: Request, res: Response): void => {
    const { borrowerId } = req.params;
    const normalizedId = Array.isArray(borrowerId) ? borrowerId[0] : borrowerId;
    const data = mockBorrowerData[normalizedId.toLowerCase()];

    if (!data) {
        if (strictUnknownBorrowers) {
            res.json({
                financials: { incomeStabilityScore: 0, debtToIncome: 1, averageMonthlyFreeCashFlow: 0 },
                credit: { creditRiskScore: 0, pastRepaymentScore: 0, publicBankruptcies: true },
                compliance: { kycPassed: false, amlFlag: true, reason: 'PROFILE_NOT_FOUND' }
            });
            return;
        }

        res.json({
            financials: { incomeStabilityScore: 0.95, debtToIncome: 0.15, averageMonthlyFreeCashFlow: 25000 },
            credit: { creditRiskScore: 0.92, pastRepaymentScore: 0.98, publicBankruptcies: false },
            compliance: { kycPassed: true, amlFlag: false }
        });
        return;
    }

    res.json(data);
});

// 4. Asset Endpoint
app.get('/api/assets/:assetId', async (req: Request, res: Response): Promise<void> => {
    const { assetId } = req.params;
    const address = req.query.address as string;
    
    // If an address is provided, fetch real geographic data to simulate realistic metrics
    if (address && address.trim().length > 0) {
        try {
            console.log(`[API] Fetching real location data for: ${address}`);
            const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
            const geoResponse = await fetch(nominatimUrl, {
                headers: { 'User-Agent': 'CreditWeave-Demo/1.0' }
            });
            const geoData = await geoResponse.json();

            if (geoData && geoData.length > 0) {
                const location = geoData[0];
                const lat = parseFloat(location.lat);
                const lon = parseFloat(location.lon);
                
                // Deterministic pseudo-random generation based on lat/lon
                // e.g. Coastal properties (like Miami) might have higher appreciation but higher volatility
                const isCoastal = Math.abs(lon) > 75 && Math.abs(lon) < 85 && lat < 35; // Rough heuristic
                const navVolatility = isCoastal ? 0.08 : 0.04;
                const marketAppreciation1Y = isCoastal ? 0.06 : 0.03;
                
                // Property age pseudo-randomly derived from coordinate digits
                const propertyAgeYears = Math.floor(Math.abs(lat * 10) % 50) + 5;
                // Wider DSCR range (1.1 to 2.1)
                const rentalCoverageRatio = 1.1 + (Math.abs(lon * 10) % 100) / 100; 
                const occupancyRate = 0.85 + (Math.abs(lat * 10) % 15) / 100; // 0.85 to 0.99

                res.json({
                    cashflowHealth: rentalCoverageRatio > 1.25 ? "PERFORMING" : "GRACE_PERIOD",
                    navVolatility: parseFloat(navVolatility.toFixed(3)),
                    rentalCoverageRatio: parseFloat(rentalCoverageRatio.toFixed(2)),
                    propertyAgeYears,
                    occupancyRate: parseFloat(occupancyRate.toFixed(2)),
                    marketAppreciation1Y: parseFloat(marketAppreciation1Y.toFixed(3)),
                    zipCode: location.display_name.match(/\b\d{5}\b/)?.[0] || "00000",
                    address: location.display_name
                });
                return;
            }
        } catch (error) {
            console.error(`[API] Failed to fetch Nominatim data:`, error);
        }
    }

    const normalizedAssetId = Array.isArray(assetId) ? assetId[0] : assetId;
    const data = mockAssetData[normalizedAssetId];
    
    if (!data) {
        // Fallback for unknown assets
        res.json({
            cashflowHealth: "PERFORMING",
            navVolatility: 0.05,
            rentalCoverageRatio: 1.20,
            propertyAgeYears: 10,
            occupancyRate: 0.90,
            marketAppreciation1Y: 0.02,
            zipCode: "00000",
            address: "Unknown Location"
        });
        return;
    }
    res.json(data);
});

// 5. Mock IPFS Encrypted Data Store (Future Phase)
const mockIpfsStore: Record<string, string> = {};

app.post('/api/ipfs/upload', (req: Request, res: Response): void => {
    const { encryptedBlob } = req.body;
    if (!encryptedBlob) {
        res.status(400).json({ error: 'Missing encryptedBlob' });
        return;
    }
    // Simulate generating a CID hash for the encrypted payload
    const mockCid = 'ipfs://qmMock' + Date.now();
    mockIpfsStore[mockCid] = encryptedBlob;
    res.json({ cid: mockCid });
});

app.get('/api/ipfs/:cid', (req: Request, res: Response): void => {
    const { cid } = req.params;
    const blob = mockIpfsStore[`ipfs://${cid}`];
    if (!blob) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    res.json({ encryptedBlob: blob });
});

// 6. Explanations Endpoint (Confidential)
app.post('/api/explanations', (req: Request, res: Response): void => {
    const { hash, explanation } = req.body;
    if (!hash || !explanation) {
        res.status(400).json({ error: 'Missing hash or explanation' });
        return;
    }
    mockExplanations[hash] = explanation;
    res.json({ success: true });
});

// Health check (Public)
app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'CreditWeave Private API Proxy' });
});

app.listen(port, () => {
    console.log(`[Private APIs] Server running securely on http://localhost:${port}`);
    console.log(`[Private APIs] Test Key: ${process.env.CRE_API_KEY || 'sk_test_12345'}`);
});
