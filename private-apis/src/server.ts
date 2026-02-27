import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import { z } from "zod";
import crypto from "crypto";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

const strictUnknownBorrowers = process.env.STRICT_UNKNOWN_BORROWERS !== "false";

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(helmet());

// -----------------------------
// Helpers: ids, hashing, typing
// -----------------------------
const BorrowerIdSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "borrowerId must be a 0x-prefixed 20-byte hex address")
  .transform((s) => s.toLowerCase());

const AssetIdSchema = z
  .string()
  .regex(/^\d+$/, "assetId must be numeric")
  .transform((s) => s);

function sha256Hex(data: string): `0x${string}` {
  const h = crypto.createHash("sha256").update(data).digest("hex");
  return (`0x${h}`) as `0x${string}`;
}

// stable-ish JSON hashing: sort object keys recursively
function canonicalize(value: any): any {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc: any, k) => {
        acc[k] = canonicalize(value[k]);
        return acc;
      }, {});
  }
  return value;
}

function computeSourceHash(payload: any): `0x${string}` {
  const canonical = canonicalize(payload);
  return sha256Hex(JSON.stringify(canonical));
}

function stableId(prefix: string, seed: string): string {
  const h = crypto.createHash("sha256").update(`${prefix}:${seed}`).digest("hex").slice(0, 24);
  return `${prefix}_${h}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function withMeta<T extends object>(args: {
  sourceVersion: string;
  ttlSeconds: number;
  reportIdPrefix: string;
  seed: string;
  data: T;
}) {
  const pulledAt = nowIso();
  const reportId = stableId(args.reportIdPrefix, args.seed);
  const sourceHash = computeSourceHash(args.data);
  return {
    reportId,
    pulledAt,
    ttlSeconds: args.ttlSeconds,
    sourceVersion: args.sourceVersion,
    sourceHash,
    data: args.data,
  };
}

// -----------------------------
// Auth (keep your bearer token)
// -----------------------------
const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.CRE_API_KEY;

  if (!expectedToken) {
    res.status(500).json({ error: "CRE_API_KEY is not configured on server" });
    return;
  }
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }
  const token = authHeader.split(" ")[1];
  if (token !== expectedToken) {
    res.status(403).json({ error: "Invalid API Key" });
    return;
  }
  next();
};

// -----------------------------
// Persistent Storage (SQLite)
// -----------------------------
let db: any;
async function initDb() {
  db = await open({
    filename: './.data/database.sqlite',
    driver: sqlite3.Database
  });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS explanations (
      hash TEXT PRIMARY KEY,
      explanation TEXT,
      meta TEXT,
      storedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS geo_cache (
      address TEXT PRIMARY KEY,
      data TEXT
    );
  `);
  console.log("[Private APIs] SQLite database initialized");
}
initDb().catch(console.error);

// -----------------------------
// Deterministic scenario generator (Step 3)
// -----------------------------
type BorrowerScenario = "PRIME" | "AVERAGE" | "STRESSED" | "FRAUD_FLAGGED" | "THIN_FILE";
type AssetScenario = "CORE" | "VALUE_ADD" | "DISTRESSED";

function pickScenarioFromSeed<T extends string>(seed: string, choices: T[]): T {
  // Always return the best case scenario for the demo
  if (choices.includes("PRIME" as T)) return "PRIME" as T;
  if (choices.includes("CORE" as T)) return "CORE" as T;
  
  // Fallback to the first choice if PRIME/CORE aren't options
  return choices[0];
}

function generateBorrowerProfile(borrowerId: string) {
  const scenario: BorrowerScenario =
    pickScenarioFromSeed(borrowerId, ["PRIME", "AVERAGE", "STRESSED", "THIN_FILE", "FRAUD_FLAGGED"]);

  // Base monthly income by scenario
  const baseIncome =
    scenario === "PRIME" ? 12000 :
    scenario === "AVERAGE" ? 7500 :
    scenario === "STRESSED" ? 4800 :
    scenario === "THIN_FILE" ? 6500 :
    7000;

  // Debt payment as a fraction of income
  const debtFrac =
    scenario === "PRIME" ? 0.22 :
    scenario === "AVERAGE" ? 0.35 :
    scenario === "STRESSED" ? 0.55 :
    scenario === "THIN_FILE" ? 0.40 :
    0.45;

  const incomeNoise = (parseInt(crypto.createHash("sha256").update(borrowerId).digest("hex").slice(0, 2), 16) - 128) / 128;
  const monthlyIncome = Math.max(1500, Math.round(baseIncome * (1 + 0.08 * incomeNoise)));

  const monthlyDebtPayments = Math.round(monthlyIncome * debtFrac);
  const monthlyNonDebtExpenses = Math.round(monthlyIncome * (scenario === "PRIME" ? 0.45 : scenario === "STRESSED" ? 0.55 : 0.50));
  const averageMonthlyFreeCashFlow = Math.max(0, monthlyIncome - monthlyDebtPayments - monthlyNonDebtExpenses);

  const debtToIncome = monthlyIncome > 0 ? monthlyDebtPayments / monthlyIncome : 1;

  const incomeStabilityScore =
    scenario === "PRIME" ? 0.88 :
    scenario === "AVERAGE" ? 0.72 :
    scenario === "STRESSED" ? 0.48 :
    scenario === "THIN_FILE" ? 0.60 :
    0.65;

  const creditRiskScore =
    scenario === "PRIME" ? 0.90 :
    scenario === "AVERAGE" ? 0.70 :
    scenario === "STRESSED" ? 0.52 :
    scenario === "THIN_FILE" ? 0.58 :
    0.35;

  const pastRepaymentScore =
    scenario === "PRIME" ? 0.95 :
    scenario === "AVERAGE" ? 0.82 :
    scenario === "STRESSED" ? 0.62 :
    scenario === "THIN_FILE" ? 0.65 :
    0.40;

  const publicBankruptcies = scenario === "FRAUD_FLAGGED" ? true : scenario === "STRESSED" ? true : false;

  // Compliance: fail-closed for fraud flagged; for thin-file allow KYC but maybe additional review later
  const kycPassed = scenario === "FRAUD_FLAGGED" ? false : true;
  const amlFlag = scenario === "FRAUD_FLAGGED" ? true : false;

  return {
    scenario,
    financials: {
      monthlyIncome,
      monthlyDebtPayments,
      monthlyNonDebtExpenses,
      debtToIncome: Number(debtToIncome.toFixed(2)),
      averageMonthlyFreeCashFlow,
      incomeStabilityScore: Number(incomeStabilityScore.toFixed(2)),
    },
    credit: {
      creditRiskScore: Number(creditRiskScore.toFixed(2)),
      pastRepaymentScore: Number(pastRepaymentScore.toFixed(2)),
      publicBankruptcies,
    },
    compliance: {
      kycPassed,
      amlFlag,
      // optional
      watchlistHit: scenario === "FRAUD_FLAGGED",
    },
  };
}

async function geoLookup(address: string) {
  const cached = await db.get('SELECT data FROM geo_cache WHERE address = ?', address);
  if (cached) return JSON.parse(cached.data);

  let lat: number | null = null;
  let lon: number | null = null;
  let displayName = address;
  let zipCode = "00000";
  let yearBuilt: number | null = null;

  const rentCastKey = process.env.RENTCAST_API_KEY;
  if (rentCastKey) {
    try {
      const rcRes = await fetch(`https://api.rentcast.io/v1/properties?address=${encodeURIComponent(address)}`, {
        headers: { "X-Api-Key": rentCastKey, "accept": "application/json" }
      });
      if (rcRes.ok) {
        const rcData = await rcRes.json();
        if (rcData && rcData.length > 0) {
          const prop = rcData[0];
          lat = prop.latitude;
          lon = prop.longitude;
          displayName = prop.formattedAddress || address;
          zipCode = prop.zipCode || "00000";
          yearBuilt = prop.yearBuilt || null;
        }
      }
    } catch (e) {
      console.warn("RentCast lookup failed, falling back to Nominatim", e);
    }
  }

  // Fallback to Nominatim if RentCast fails or key is missing
  if (lat === null || lon === null) {
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    const geoResponse = await fetch(nominatimUrl, { headers: { "User-Agent": "CreditWeave-Demo/1.0" } });
    if (!geoResponse.ok) throw new Error(`Nominatim HTTP ${geoResponse.status}`);
    const geoData = await geoResponse.json();
    if (!geoData || geoData.length === 0) return null;
    const loc = geoData[0];
    lat = parseFloat(loc.lat);
    lon = parseFloat(loc.lon);
    displayName = loc.display_name as string;
    zipCode = loc.display_name.match(/\b\d{5}\b/)?.[0] || "00000";
  }
  
  const result = { lat, lon, displayName, zipCode, yearBuilt };
  await db.run('INSERT OR REPLACE INTO geo_cache (address, data) VALUES (?, ?)', address, JSON.stringify(result));
  return result;
}

function generateAssetMetrics(assetId: string, geo: null | { lat: number; lon: number; zipCode: string; displayName: string; yearBuilt?: number | null }) {
  const scenario: AssetScenario =
    pickScenarioFromSeed(assetId, ["CORE", "VALUE_ADD", "DISTRESSED"]);

  const lat = geo?.lat ?? 34.05;
  const lon = geo?.lon ?? -118.25;

  const addressString = geo?.displayName || assetId;
  const addressHash = crypto.createHash("md5").update(addressString.toLowerCase()).digest("hex");
  const addressInt = parseInt(addressHash.slice(0, 8), 16);

  let propertyAgeYears;
  if (geo?.yearBuilt) {
    propertyAgeYears = Math.max(0, new Date().getFullYear() - geo.yearBuilt);
  } else {
    propertyAgeYears = scenario === "CORE" ? (addressInt % 10) + 2 : (addressInt % 50) + 10;
  }

  const baseVol = scenario === "CORE" ? 0.04 : scenario === "VALUE_ADD" ? 0.07 : 0.10;
  const volNoise = (addressInt % 30) / 1000;
  const navVolatility = Number((baseVol + volNoise).toFixed(3));

  const baseAppreciation = scenario === "CORE" ? 0.03 : scenario === "VALUE_ADD" ? 0.02 : -0.01;
  const appNoise = (addressInt % 20) / 1000;
  const marketAppreciation1Y = Number((baseAppreciation + appNoise).toFixed(3));

  const baseOcc = scenario === "CORE" ? 0.95 : scenario === "VALUE_ADD" ? 0.88 : 0.78;
  const occupancyRate = Math.min(0.99, Math.max(0.65, baseOcc + ((Math.abs(lat * 10) % 10) - 5) / 200));

  // Derive DSCR-ish coverage from occupancy and scenario
  const baseDscr = scenario === "CORE" ? 1.45 : scenario === "VALUE_ADD" ? 1.20 : 1.05;
  const rentalCoverageRatio = Math.max(0.90, Number((baseDscr * occupancyRate).toFixed(2)));

  // Cashflow health correlated to DSCR
  const cashflowHealth =
    rentalCoverageRatio >= 1.25 ? "PERFORMING" :
    rentalCoverageRatio >= 1.10 ? "GRACE_PERIOD" :
    rentalCoverageRatio >= 1.00 ? "LATE" :
    "DEFAULTED";

  return {
    scenario,
    cashflowHealth,
    navVolatility,
    rentalCoverageRatio,
    propertyAgeYears,
    occupancyRate: Number(occupancyRate.toFixed(2)),
    marketAppreciation1Y,
    zipCode: geo?.zipCode ?? "00000",
    address: geo?.displayName ?? "Unknown Location",
  };
}

// -----------------------------
// Public: explanations for frontend
// -----------------------------
app.get("/frontend/explanations/:hash", async (req, res) => {
  const hash = String(req.params.hash || "").trim();
  const row = await db.get('SELECT explanation, meta, storedAt FROM explanations WHERE hash = ?', hash);
  if (!row) return res.status(404).json({ error: "Explanation not found" });
  return res.json({
    explanation: JSON.parse(row.explanation),
    meta: row.meta ? JSON.parse(row.meta) : null,
    storedAt: row.storedAt
  });
});

// -----------------------------
// Private/authenticated routes
// -----------------------------
app.use("/api", authenticate);
app.use("/api/v1", authenticate);

// (Step 1) Vendor-like endpoints
app.get("/api/v1/vendors/plaid/summary/:borrowerId", (req, res) => {
  const parsed = BorrowerIdSchema.safeParse(req.params.borrowerId);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const borrowerId = parsed.data;

  const profile = generateBorrowerProfile(borrowerId);

  // Plaid-ish: focus on cashflow, income, debts
  const data = {
    borrowerId,
    cashflow: {
      monthlyIncome: profile.financials.monthlyIncome,
      monthlyDebtPayments: profile.financials.monthlyDebtPayments,
      monthlyNonDebtExpenses: profile.financials.monthlyNonDebtExpenses,
      avgMonthlyFreeCashFlow: profile.financials.averageMonthlyFreeCashFlow,
    },
    derived: {
      debtToIncome: profile.financials.debtToIncome,
      incomeStabilityScore: profile.financials.incomeStabilityScore,
    },
    notes: scenarioNote(profile.scenario),
  };

  return res.json(withMeta({
    sourceVersion: "cw-mock-plaid-v1",
    ttlSeconds: 6 * 60 * 60,
    reportIdPrefix: "plaid",
    seed: borrowerId,
    data,
  }));
});

app.get("/api/v1/vendors/experian/report/:borrowerId", (req, res) => {
  const parsed = BorrowerIdSchema.safeParse(req.params.borrowerId);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const borrowerId = parsed.data;

  const profile = generateBorrowerProfile(borrowerId);

  const data = {
    borrowerId,
    scores: {
      creditRiskScore: profile.credit.creditRiskScore,
      pastRepaymentScore: profile.credit.pastRepaymentScore,
    },
    publicRecords: {
      bankruptcies: profile.credit.publicBankruptcies ? 1 : 0,
    },
    notes: scenarioNote(profile.scenario),
  };

  return res.json(withMeta({
    sourceVersion: "cw-mock-experian-v1",
    ttlSeconds: 24 * 60 * 60,
    reportIdPrefix: "exp",
    seed: borrowerId,
    data,
  }));
});

app.get("/api/v1/vendors/onfido/check/:borrowerId", (req, res) => {
  const parsed = BorrowerIdSchema.safeParse(req.params.borrowerId);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const borrowerId = parsed.data;

  const profile = generateBorrowerProfile(borrowerId);

  const data = {
    borrowerId,
    kycPassed: profile.compliance.kycPassed,
    amlFlag: profile.compliance.amlFlag,
    watchlistHit: profile.compliance.watchlistHit ?? false,
    reason: profile.compliance.kycPassed ? "PASS" : "FAIL",
  };

  return res.json(withMeta({
    sourceVersion: "cw-mock-onfido-v1",
    ttlSeconds: 7 * 24 * 60 * 60,
    reportIdPrefix: "kyc",
    seed: borrowerId,
    data,
  }));
});

app.get("/api/v1/vendors/geo/property", async (req, res) => {
  const address = String(req.query.address ?? "").trim();
  if (!address) return res.status(400).json({ error: "Missing address" });

  try {
    const geo = await geoLookup(address);
    if (!geo) return res.status(404).json({ error: "Address not found" });

    const data = { address, ...geo };
    return res.json(withMeta({
      sourceVersion: "cw-geo-nominatim-v1",
      ttlSeconds: 30 * 24 * 60 * 60,
      reportIdPrefix: "geo",
      seed: address,
      data,
    }));
  } catch (e) {
    return res.status(502).json({ error: "GEO_LOOKUP_FAILED", details: String(e) });
  }
});

// (Step 1+2+3) Normalized underwriting context endpoint
app.get("/api/v1/underwriting/context", async (req, res) => {
  const borrowerParse = BorrowerIdSchema.safeParse(req.query.borrowerId);
  const assetParse = AssetIdSchema.safeParse(String(req.query.assetId ?? ""));
  const address = String(req.query.address ?? "").trim();

  if (!borrowerParse.success) return res.status(400).json({ error: borrowerParse.error.message });
  if (!assetParse.success) return res.status(400).json({ error: assetParse.error.message });

  const borrowerId = borrowerParse.data;
  const assetId = assetParse.data;

  const borrowerProfile = generateBorrowerProfile(borrowerId);

  let geo: any = null;
  if (address) {
    try {
      geo = await geoLookup(address);
    } catch {
      geo = null;
    }
  }

  const assetMetrics = generateAssetMetrics(assetId, geo);

  const context = {
    borrowerId,
    assetId,
    pulledAt: nowIso(),
    ttlSeconds: 6 * 60 * 60,
    sourceVersion: "cw-underwriting-context-v1",
    // provenance references to “vendor reports”
    vendorRefs: {
      plaidReportId: stableId("plaid", borrowerId),
      experianReportId: stableId("exp", borrowerId),
      kycReportId: stableId("kyc", borrowerId),
      geoReportId: address ? stableId("geo", address) : null,
    },
    borrower: {
      financials: {
        incomeStabilityScore: borrowerProfile.financials.incomeStabilityScore,
        debtToIncome: borrowerProfile.financials.debtToIncome,
        averageMonthlyFreeCashFlow: borrowerProfile.financials.averageMonthlyFreeCashFlow,
        // optional extra fields for future: make CRE ignore if not needed
        monthlyIncome: borrowerProfile.financials.monthlyIncome,
        monthlyDebtPayments: borrowerProfile.financials.monthlyDebtPayments,
        monthlyNonDebtExpenses: borrowerProfile.financials.monthlyNonDebtExpenses,
      },
      credit: borrowerProfile.credit,
      compliance: borrowerProfile.compliance,
      scenario: borrowerProfile.scenario,
    },
    asset: {
      metrics: assetMetrics,
      scenario: assetMetrics.scenario,
    },
  };

  const sourceHash = computeSourceHash(context);
  return res.json({ ...context, sourceHash });
});

// explanations write
app.post("/api/v1/explanations", async (req, res) => {
  const BodySchema = z.object({
    hash: z.string().min(3),
    explanation: z.object({
      summary: z.string(),
      keyRisks: z.array(z.string()).optional(),
      confidenceLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
      riskFlags: z.array(z.string()).optional()
    }),
    meta: z
      .object({
        policyVersion: z.string().optional(),
        inputSourceHash: z.string().optional(),
        model: z.string().optional(),
      })
      .optional(),
  });

  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  const { hash, explanation, meta } = parsed.data;
  await db.run(
    'INSERT OR REPLACE INTO explanations (hash, explanation, meta, storedAt) VALUES (?, ?, ?, ?)',
    hash,
    JSON.stringify(explanation),
    meta ? JSON.stringify(meta) : null,
    nowIso()
  );
  return res.json({ success: true });
});

// -----------------------------------
// Legacy route aliases (back-compat)
// -----------------------------------

// old aggregate borrower endpoint
app.get("/api/borrower-data/:borrowerId", (req, res, next) => {
  // emulate previous shape: {financials, credit, compliance}
  const parsed = BorrowerIdSchema.safeParse(req.params.borrowerId);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const borrowerId = parsed.data;

  const profile = generateBorrowerProfile(borrowerId);

  return res.json({
    financials: {
      incomeStabilityScore: profile.financials.incomeStabilityScore,
      debtToIncome: profile.financials.debtToIncome,
      averageMonthlyFreeCashFlow: profile.financials.averageMonthlyFreeCashFlow,
    },
    credit: profile.credit,
    compliance: {
      kycPassed: profile.compliance.kycPassed,
      amlFlag: profile.compliance.amlFlag,
    },
  });
});

// old asset endpoint
app.get("/api/assets/:assetId", async (req, res) => {
  const assetParse = AssetIdSchema.safeParse(req.params.assetId);
  if (!assetParse.success) return res.status(400).json({ error: assetParse.error.message });
  const assetId = assetParse.data;

  const address = String(req.query.address ?? "").trim();

  let geo: any = null;
  if (address) {
    try {
      geo = await geoLookup(address);
    } catch {
      geo = null;
    }
  }

  const assetMetrics = generateAssetMetrics(assetId, geo);
  return res.json(assetMetrics);
});

// old explanations endpoint
app.post("/api/explanations", (req, res) => {
  // alias -> v1
  return app._router.handle(
    { ...req, url: "/api/v1/explanations" } as any,
    res,
    (() => {}) as any
  );
});

// health
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "CreditWeave Private API Proxy", version: "v1" });
});

function scenarioNote(s: BorrowerScenario) {
  switch (s) {
    case "PRIME": return "Strong profile: stable income, low leverage, strong repayment.";
    case "AVERAGE": return "Typical profile: acceptable DTI and repayment, moderate risk.";
    case "STRESSED": return "Stressed profile: higher leverage and weaker repayment signals.";
    case "THIN_FILE": return "Thin file: limited credit history; may require manual review.";
    case "FRAUD_FLAGGED": return "Flagged: compliance/fraud indicators present.";
  }
}

app.listen(port, () => {
  console.log(`[Private APIs] Server running on http://localhost:${port}`);
});