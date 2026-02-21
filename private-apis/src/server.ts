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

// Health check (Public)
app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'CreditWeave Private API Proxy' });
});

app.listen(port, () => {
    console.log(`[Private APIs] Server running securely on http://localhost:${port}`);
    console.log(`[Private APIs] Test Key: ${process.env.CRE_API_KEY || 'sk_test_12345'}`);
});
