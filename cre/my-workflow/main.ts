import {
  bytesToHex,
  consensusIdenticalAggregation,
  cre,
  decodeJson,
  encodeCallMsg,
  EVMClient,
  type EVMLog,
  hexToBase64,
  LATEST_BLOCK_NUMBER,
  Runner,
  TxStatus,
  type Runtime,
} from "@chainlink/cre-sdk";
import { type Address, decodeEventLog, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, toHex, zeroAddress } from "viem";

const UNDERWRITING_EVENT_ABI = parseAbi([
  "event UnderwritingRequested(address indexed borrower, uint256 indexed assetId, uint256 intendedBorrowAmount)",
]);

const ASSET_REGISTRY_ABI = parseAbi([
  "function getAssetCore(uint256) view returns (uint256 assetId, uint8 assetType, address originator, uint8 currentStatus, uint256 assetValue, uint256 accumulatedYield)",
  "function getAssetMetadata(uint256) view returns (string ipfsMetadataHash, uint256 registrationDate, uint256 activationDate, address valuationOracle)",
]);

const NAV_ORACLE_ABI = parseAbi([
  "function isFresh(uint256 assetId) view returns (bool)",
  "function getNAVData(uint256 assetId) view returns (uint256 nav, uint256 updatedAt, bytes32 sourceHash)",
]);

const UNDERWRITING_REGISTRY_ABI = parseAbi([
  "function getRequestedBorrowAmount(address borrower, uint256 assetId) view returns (uint256)",
]);

const processedRequestIds = new Set<string>();

type Config = {
  schedule: string;
  underwritingRegistryAddress: Address;
  navOracleAddress: Address;
  lendingPoolAddress: Address;
  rwaAssetRegistryAddress: Address;
  chainSelectorName?: string;
  chainId?: number;
  aiModelName: string;
  privateApiUrl: string;
  baseRateBps: number;
  rateSpreadPerRiskTier: number;
  maxLtvBaseBps: number;
  maxLtvReductionPerRiskTier: number;
  gasLimit?: string;
};

interface BorrowerMetrics {
  incomeStabilityScore: number;
  creditRiskScore: number;
  debtToIncome: number;
  pastRepaymentScore: number;
  employmentLengthMonths: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  liquidAssets: number;
  totalLiabilities: number;
}

interface ComplianceMetrics {
  kycPassed: boolean;
  amlFlag: boolean;
  publicBankruptcies: boolean;
}

interface BorrowerFetchResult {
  borrowerMetrics: BorrowerMetrics;
  compliance: ComplianceMetrics;
}

interface AssetMetrics {
  cashflowHealth: "PERFORMING" | "GRACE_PERIOD" | "LATE" | "DEFAULTED";
  navVolatility: number;
  rentalCoverageRatio: number;
  propertyAgeYears: number;
  occupancyRate: number;
  marketAppreciation1Y: number;
}

interface MacroContext {
  propertyIndexTrend: "RISING" | "STABLE" | "DECLINING";
  regionalDefaultRate: number;
  interestRateEnvironment: "LOW" | "MODERATE" | "HIGH";
  unemploymentTrend: "IMPROVING" | "STABLE" | "WORSENING";
}

interface AIUnderwritingInput {
  borrowerMetrics: BorrowerMetrics;
  assetMetrics: AssetMetrics;
  macroContext: MacroContext;
  requestedLoanAmount: number;
  collateralValue: number;
}

interface AIUnderwritingOutput {
  approved: boolean;
  riskTier: number;
  maxLtvBps: number;
  rateBps: number;
  expiry: number;
  explanation: string;
}

interface AIExplanation {
  summary: string;
  keyRisks: string[];
  confidenceLevel: "LOW" | "MEDIUM" | "HIGH";
  riskFlags: string[];
}

interface OnchainTerms {
  borrower: Address;
  assetId: bigint;
  approved: boolean;
  maxLtvBps: number;
  rateBps: number;
  expiry: bigint;
  reasoningHash: `0x${string}`;
}

type NavSnapshot = {
  nav: bigint;
  updatedAt: bigint;
  sourceHash: `0x${string}`;
  isFresh: boolean;
};

type NavComputationResult = {
  nav: bigint;
  sourceHash: `0x${string}`;
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const getChainSelector = (config: Config): bigint => {
  const selectorName = config.chainSelectorName ?? "ethereum-testnet-sepolia";
  const selector = EVMClient.SUPPORTED_CHAIN_SELECTORS[selectorName as keyof typeof EVMClient.SUPPORTED_CHAIN_SELECTORS];
  if (!selector) {
    throw new Error(`Unsupported chain selector name: ${selectorName}`);
  }
  return selector;
};

const getSecretValue = (runtime: Runtime<Config>, id: string): string => {
  const secret = runtime.getSecret({ id }).result();
  const value = secret.value ?? "";
  if (!value) {
    throw new Error(`Missing secret value for ${id}`);
  }
  return value;
};

const logAudit = (runtime: Runtime<Config>, event: string, data: Record<string, unknown>) => {
  runtime.log(
    `[AUDIT] ${JSON.stringify({
      ts: runtime.now().toISOString(),
      event,
      ...data,
    })}`,
  );
};

const logStep = (
  runtime: Runtime<Config>,
  requestId: string,
  step: string,
  message: string,
  data?: Record<string, unknown>,
) => {
  runtime.log(
    `[STEP ${step}] requestId=${requestId} ${message}${data ? ` | ${JSON.stringify(data)}` : ""}`,
  );
};

const fetchJsonWithConfidentialHttp = (
  runtime: Runtime<Config>,
  url: string,
  headers: Record<string, string>,
): Record<string, unknown> => {
  const rawBody = runtime
    .runInNodeMode(
      (nodeRuntime, ...args: unknown[]) => {
        const requestUrl = args[0] as string;
        const requestHeaders = args[1] as Record<string, string>;
        const confidentialHttpClient = new cre.capabilities.ConfidentialHTTPClient();
        const response = confidentialHttpClient
          .sendRequest(nodeRuntime, {
            request: {
              url: requestUrl,
              method: "GET",
              multiHeaders: Object.fromEntries(
                Object.entries(requestHeaders).map(([key, value]) => [key, { values: [value] }]),
              ),
            },
          })
          .result();

        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw new Error(`HTTP request failed (${response.statusCode}) for ${requestUrl}`);
        }

        return new TextDecoder().decode(response.body);
      },
      consensusIdenticalAggregation<string>(),
    )(url, headers)
    .result();

  return decodeJson(new TextEncoder().encode(rawBody)) as Record<string, unknown>;
};

const postJsonWithConfidentialHttp = (
  runtime: Runtime<Config>,
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Record<string, unknown> => {
  const rawBody = runtime
    .runInNodeMode(
      (nodeRuntime, ...args: unknown[]) => {
        const requestUrl = args[0] as string;
        const requestHeaders = args[1] as Record<string, string>;
        const requestBody = JSON.stringify(args[2] as Record<string, unknown>);

        const confidentialHttpClient = new cre.capabilities.ConfidentialHTTPClient();
        const response = confidentialHttpClient
          .sendRequest(nodeRuntime, {
            request: {
              url: requestUrl,
              method: "POST",
              multiHeaders: Object.fromEntries(
                Object.entries(requestHeaders).map(([key, value]) => [key, { values: [value] }]),
              ) as any,
              bodyString: requestBody,
            },
          })
          .result();

        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw new Error(`HTTP request failed (${response.statusCode}) for ${requestUrl}`);
        }

        return new TextDecoder().decode(response.body);
      },
      consensusIdenticalAggregation<string>(),
    )(url, headers, body)
    .result();

  return decodeJson(new TextEncoder().encode(rawBody)) as Record<string, unknown>;
};

const fetchOnchainAssetData = (
  runtime: Runtime<Config>,
  evmClient: EVMClient,
  registryAddress: Address,
  assetId: bigint,
): { assetValue: bigint; currentStatus: number; metadataHash: string } => {
  const callDataCore = encodeFunctionData({
    abi: ASSET_REGISTRY_ABI,
    functionName: "getAssetCore",
    args: [assetId],
  });

  const resultCore = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: registryAddress,
        data: callDataCore,
      }),
      blockNumber: LATEST_BLOCK_NUMBER,
    })
    .result();

  const decodedCore = decodeFunctionResult({
    abi: ASSET_REGISTRY_ABI,
    functionName: "getAssetCore",
    data: bytesToHex(resultCore.data),
  });

  const callDataMetadata = encodeFunctionData({
    abi: ASSET_REGISTRY_ABI,
    functionName: "getAssetMetadata",
    args: [assetId],
  });

  const resultMetadata = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: registryAddress,
        data: callDataMetadata,
      }),
      blockNumber: LATEST_BLOCK_NUMBER,
    })
    .result();

  const decodedMetadata = decodeFunctionResult({
    abi: ASSET_REGISTRY_ABI,
    functionName: "getAssetMetadata",
    data: bytesToHex(resultMetadata.data),
  });

  return {
    assetValue: decodedCore[4],
    currentStatus: Number(decodedCore[3]),
    metadataHash: decodedMetadata[0] as string,
  };
};

const fetchNavSnapshot = (
  runtime: Runtime<Config>,
  evmClient: EVMClient,
  navOracleAddress: Address,
  assetId: bigint,
): NavSnapshot => {
  const isFreshCallData = encodeFunctionData({
    abi: NAV_ORACLE_ABI,
    functionName: "isFresh",
    args: [assetId],
  });

  const isFreshResult = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: navOracleAddress,
        data: isFreshCallData,
      }),
      blockNumber: LATEST_BLOCK_NUMBER,
    })
    .result();

  const isFresh = decodeFunctionResult({
    abi: NAV_ORACLE_ABI,
    functionName: "isFresh",
    data: bytesToHex(isFreshResult.data),
  });

  const navDataCallData = encodeFunctionData({
    abi: NAV_ORACLE_ABI,
    functionName: "getNAVData",
    args: [assetId],
  });

  const navDataResult = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: navOracleAddress,
        data: navDataCallData,
      }),
      blockNumber: LATEST_BLOCK_NUMBER,
    })
    .result();

  const decodedNav = decodeFunctionResult({
    abi: NAV_ORACLE_ABI,
    functionName: "getNAVData",
    data: bytesToHex(navDataResult.data),
  });

  return {
    nav: decodedNav[0],
    updatedAt: decodedNav[1],
    sourceHash: decodedNav[2],
    isFresh,
  };
};

const fetchRequestedBorrowAmount = (
  runtime: Runtime<Config>,
  evmClient: EVMClient,
  registryAddress: Address,
  borrower: Address,
  assetId: bigint,
): bigint => {
  const callData = encodeFunctionData({
    abi: UNDERWRITING_REGISTRY_ABI,
    functionName: "getRequestedBorrowAmount",
    args: [borrower, assetId],
  });

  const result = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: registryAddress,
        data: callData,
      }),
      blockNumber: LATEST_BLOCK_NUMBER,
    })
    .result();

  return decodeFunctionResult({
    abi: UNDERWRITING_REGISTRY_ABI,
    functionName: "getRequestedBorrowAmount",
    data: bytesToHex(result.data),
  });
};

const fetchBorrowerData = (
  runtime: Runtime<Config>,
  borrower: Address,
  privateApiUrl: string,
  creApiKey: string,
): BorrowerFetchResult => {
  try {
    const authHeaders = {
      Authorization: `Bearer ${creApiKey}`,
      "Content-Type": "application/json",
    };

    const data = fetchJsonWithConfidentialHttp(
      runtime,
      `${privateApiUrl}/api/borrower-data/${borrower}`,
      authHeaders,
    ) as {
      financials: Record<string, number>;
      credit: Record<string, number | boolean>;
      compliance: Record<string, boolean>;
    };

    const { financials, credit, compliance } = data;

    const monthlyIncome = Number(financials.averageMonthlyFreeCashFlow ?? 4000) * 2;
    const debtToIncome = Number(financials.debtToIncome ?? 0.4);

    return {
      borrowerMetrics: {
        incomeStabilityScore: Number(financials.incomeStabilityScore ?? 0.75),
        creditRiskScore: Number(credit.creditRiskScore ?? 0.72),
        debtToIncome,
        pastRepaymentScore: Number(credit.pastRepaymentScore ?? 0.85),
        employmentLengthMonths: 36,
        monthlyIncome,
        monthlyExpenses: monthlyIncome * debtToIncome,
        liquidAssets: monthlyIncome * 3,
        totalLiabilities: monthlyIncome * 12 * debtToIncome,
      },
      compliance: {
        kycPassed: Boolean(compliance.kycPassed),
        amlFlag: Boolean(compliance.amlFlag),
        publicBankruptcies: Boolean(credit.publicBankruptcies),
      },
    };
  } catch (error) {
    logAudit(runtime, "borrower_data_fetch_failed", {
      borrower,
      error: String(error),
    });
    return {
      borrowerMetrics: {
        incomeStabilityScore: 0.4,
        creditRiskScore: 0.4,
        debtToIncome: 0.8,
        pastRepaymentScore: 0.4,
        employmentLengthMonths: 0,
        monthlyIncome: 0,
        monthlyExpenses: 0,
        liquidAssets: 0,
        totalLiabilities: 0,
      },
      compliance: {
        kycPassed: false,
        amlFlag: true,
        publicBankruptcies: true,
      },
    };
  }
};

const fetchAssetPerformanceData = (
  runtime: Runtime<Config>,
  assetId: bigint,
  address: string,
  privateApiUrl: string,
  creApiKey: string,
): AssetMetrics => {
  try {
    const authHeaders = {
      Authorization: `Bearer ${creApiKey}`,
      "Content-Type": "application/json",
    };

    const assetData = fetchJsonWithConfidentialHttp(
      runtime,
      `${privateApiUrl}/api/assets/${assetId.toString()}?address=${encodeURIComponent(address)}`,
      authHeaders,
    ) as Record<string, any>;

    return {
      cashflowHealth: (assetData.cashflowHealth as any) ?? "PERFORMING",
      navVolatility: Number(assetData.navVolatility ?? 0.05),
      rentalCoverageRatio: Number(assetData.rentalCoverageRatio ?? 1.2),
      propertyAgeYears: Number(assetData.propertyAgeYears ?? 10),
      occupancyRate: Number(assetData.occupancyRate ?? 0.9),
      marketAppreciation1Y: Number(assetData.marketAppreciation1Y ?? 0.02),
    };
  } catch (error) {
    logAudit(runtime, "asset_data_fetch_failed", {
      assetId: assetId.toString(),
      error: String(error),
    });
    return {
      cashflowHealth: "PERFORMING",
      navVolatility: 0.05,
      rentalCoverageRatio: 1.2,
      propertyAgeYears: 10,
      occupancyRate: 0.9,
      marketAppreciation1Y: 0.02,
    };
  }
};

const fetchMacroData = (): MacroContext => {
  return {
    propertyIndexTrend: "STABLE",
    regionalDefaultRate: 0.03,
    interestRateEnvironment: "MODERATE",
    unemploymentTrend: "STABLE",
  };
};

const deterministicUnderwriting = (
  input: AIUnderwritingInput,
  baseRateBps: number,
  rateSpreadPerRiskTier: number,
  maxLtvBaseBps: number,
  maxLtvReductionPerRiskTier: number,
): AIUnderwritingOutput => {
  // Institutional DSCR (Debt Service Coverage Ratio) Underwriting
  // In CRE, the rentalCoverageRatio is effectively the DSCR.
  const dscr = input.assetMetrics.rentalCoverageRatio;
  
  // Base borrower health
  const borrowerHealth = 
    (input.borrowerMetrics.creditRiskScore * 0.6) + 
    ((1 - input.borrowerMetrics.debtToIncome) * 0.4);

  let riskTier: number;

  // Institutional Matrix: DSCR is King
  if (dscr >= 1.5 && borrowerHealth >= 0.75) {
    riskTier = 1; // Prime: High coverage, strong borrower
  } else if (dscr >= 1.25 && borrowerHealth >= 0.65) {
    riskTier = 2; // Standard: Meets institutional minimums (DSCR > 1.25)
  } else if (dscr >= 1.1 && borrowerHealth >= 0.60) {
    riskTier = 3; // Watch: Barely covering debt
  } else if (dscr >= 1.0 || borrowerHealth >= 0.8) {
    riskTier = 4; // Substandard: Might need out-of-pocket to cover debt
  } else {
    riskTier = 5; // Default Risk: Asset loses money, borrower is stretched
  }

  if (input.assetMetrics.navVolatility > 0.08) {
    riskTier = Math.min(5, riskTier + 1);
  }
  if (input.assetMetrics.cashflowHealth === "LATE" || input.assetMetrics.cashflowHealth === "DEFAULTED") {
    riskTier = 5; // Override for actual poor performance
  }

  let maxLtvBps = Math.max(0, maxLtvBaseBps - (riskTier - 1) * maxLtvReductionPerRiskTier);
  let rateBps = baseRateBps + (riskTier - 1) * rateSpreadPerRiskTier;

  if (input.macroContext.interestRateEnvironment === "HIGH") {
    rateBps += 100;
  }
  if (input.macroContext.propertyIndexTrend === "DECLINING") {
    maxLtvBps = Math.max(0, maxLtvBps - 500);
  }

  maxLtvBps = clamp(maxLtvBps, 0, 10_000);
  rateBps = Math.max(0, rateBps);
  const approved = riskTier <= 4;
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60);

  return {
    approved,
    riskTier,
    maxLtvBps,
    rateBps,
    expiry: Number(expiry),
    explanation: `Deterministic underwriting: DSCR=${dscr.toFixed(2)}, tier=${riskTier}`,
  };
};

const hardDenyOutput = (
  reason: string,
  baseRateBps: number,
  rateSpreadPerRiskTier: number,
): AIUnderwritingOutput => {
  return {
    approved: false,
    riskTier: 5,
    maxLtvBps: 0,
    rateBps: baseRateBps + 4 * rateSpreadPerRiskTier,
    expiry: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    explanation: `Hard deny: ${reason}`,
  };
};

const runUnderwritingPolicy = (
  input: AIUnderwritingInput,
  compliance: ComplianceMetrics,
  baseRateBps: number,
  rateSpreadPerRiskTier: number,
  maxLtvBaseBps: number,
  maxLtvReductionPerRiskTier: number,
): AIUnderwritingOutput => {
  if (!compliance.kycPassed) {
    return hardDenyOutput("KYC_NOT_PASSED", baseRateBps, rateSpreadPerRiskTier);
  }
  if (compliance.amlFlag) {
    return hardDenyOutput("AML_FLAGGED", baseRateBps, rateSpreadPerRiskTier);
  }
  if (compliance.publicBankruptcies) {
    return hardDenyOutput("PUBLIC_BANKRUPTCY_PRESENT", baseRateBps, rateSpreadPerRiskTier);
  }

  return deterministicUnderwriting(
    input,
    baseRateBps,
    rateSpreadPerRiskTier,
    maxLtvBaseBps,
    maxLtvReductionPerRiskTier,
  );
};

const asObject = (value: unknown): Record<string, unknown> => {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string") as string[];
};

const stripCodeFences = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
};

const buildRiskFlags = (
  input: AIUnderwritingInput,
  decision: AIUnderwritingOutput,
  hardDenyReason: string | null,
): string[] => {
  const flags: string[] = [];
  if (hardDenyReason) flags.push(hardDenyReason);
  if (input.borrowerMetrics.debtToIncome > 0.5) flags.push("HIGH_DTI");
  if (input.assetMetrics.navVolatility > 0.1) flags.push("ELEVATED_VOLATILITY");
  if (input.macroContext.interestRateEnvironment === "HIGH") flags.push("MACRO_TIGHTENING");
  if (input.macroContext.propertyIndexTrend === "DECLINING") flags.push("DECLINING_PROPERTY_INDEX");
  if (decision.riskTier >= 4) flags.push("HIGH_RISK_TIER");
  return Array.from(new Set(flags));
};

const generateAIExplanation = (
  runtime: Runtime<Config>,
  model: string,
  geminiApiKey: string,
  input: AIUnderwritingInput,
  deterministicDecision: Pick<AIUnderwritingOutput, "approved" | "riskTier" | "maxLtvBps" | "rateBps" | "expiry">,
  riskFlags: string[],
): AIExplanation => {
  const systemPrompt = [
    "You are an expert institutional commercial real estate credit officer for a regulated onchain RWA lending protocol.",
    "Your job is to provide a deep, qualitative analysis of the deterministic loan decision provided to you.",
    "Explain the underlying reasons for the Risk Tier assigned based on standard CRE metrics like DSCR (Debt Service Coverage Ratio) and Borrower DTI.",
    "Highlight specific strengths and weaknesses of the property and the borrower's financial profile.",
    "Return STRICT JSON only.",
    'Output schema: {"summary":"string","keyRisks":["string"],"confidenceLevel":"LOW|MEDIUM|HIGH","riskFlags":["string"]}.',
  ].join(" ");

  const promptPayload = {
    deterministicDecision,
    borrowerMetrics: input.borrowerMetrics,
    assetMetrics: input.assetMetrics,
    macroContext: input.macroContext,
    requestedLoanAmount: input.requestedLoanAmount,
    collateralValue: input.collateralValue,
    deterministicRiskFlags: riskFlags,
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
    const response = postJsonWithConfidentialHttp(
      runtime,
      url,
      {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      {
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: JSON.stringify(promptPayload) }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      },
    );

    const text = String((response as any)?.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
    const parsed = decodeJson(new TextEncoder().encode(stripCodeFences(text)));
    const parsedObj = asObject(parsed);

    const confidenceRaw = String(parsedObj.confidenceLevel ?? "MEDIUM").toUpperCase();
    const confidenceLevel: AIExplanation["confidenceLevel"] =
      confidenceRaw === "LOW" || confidenceRaw === "HIGH" ? confidenceRaw : "MEDIUM";

    return {
      summary: String(parsedObj.summary ?? "Deterministic underwriting decision recorded."),
      keyRisks: toStringArray(parsedObj.keyRisks),
      confidenceLevel,
      riskFlags: Array.from(new Set([...riskFlags, ...toStringArray(parsedObj.riskFlags)])),
    };
  } catch (error) {
    logAudit(runtime, "ai_explanation_fallback", {
      model,
      error: String(error),
    });
    return {
      summary: `Deterministic underwriting decision: tier=${deterministicDecision.riskTier}, approved=${deterministicDecision.approved}.`,
      keyRisks: riskFlags.slice(0, 3),
      confidenceLevel: "MEDIUM",
      riskFlags,
    };
  }
};

const toSafeUsdNumber = (weiAmount: bigint): number => {
  const wholeUnits = weiAmount / 10n ** 18n;
  if (wholeUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Number(wholeUnits);
};

const computeAndHashNav = (
  assetId: bigint,
  assetValue: bigint,
  assetMetrics: AssetMetrics,
  macroContext: MacroContext,
): NavComputationResult => {
  const trendAdjustmentBps: Record<MacroContext["propertyIndexTrend"], number> = {
    RISING: 10300,
    STABLE: 10000,
    DECLINING: 9500,
  };

  const occupancyBps = clamp(Math.round(assetMetrics.occupancyRate * 10_000), 7000, 10_200);
  const volatilityPenaltyBps = clamp(10_000 - Math.round(assetMetrics.navVolatility * 3000), 8500, 10_000);
  const macroBps = trendAdjustmentBps[macroContext.propertyIndexTrend];

  const nav =
    (assetValue * BigInt(occupancyBps) * BigInt(volatilityPenaltyBps) * BigInt(macroBps)) /
    (10_000n * 10_000n * 10_000n);

  const sourceHash = keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint16" },
        { type: "uint16" },
        { type: "uint16" },
      ],
      [
        "creditweave-nav-v1",
        assetId,
        assetValue,
        occupancyBps,
        volatilityPenaltyBps,
        macroBps,
      ],
    ),
  );

  return { nav: nav > 0n ? nav : 1n, sourceHash };
};

const encodeNavReport = (assetId: bigint, nav: bigint, sourceHash: `0x${string}`): `0x${string}` => {
  return encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
    [assetId, nav, sourceHash],
  );
};

const updateNavOnchain = (
  runtime: Runtime<Config>,
  evmClient: EVMClient,
  navOracleAddress: Address,
  assetId: bigint,
  nav: bigint,
  sourceHash: `0x${string}`,
): `0x${string}` => {
  const encodedPayload = encodeNavReport(assetId, nav, sourceHash);
  const report = runtime
    .report({
      encodedPayload: hexToBase64(encodedPayload),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();

  const writeResult = evmClient
    .writeReport(runtime, {
      receiver: navOracleAddress,
      report,
      gasConfig: runtime.config.gasLimit ? { gasLimit: runtime.config.gasLimit } : undefined,
    })
    .result();

  if (writeResult.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`NAV write failed with status=${writeResult.txStatus}`);
  }

  return bytesToHex(writeResult.txHash || new Uint8Array(32));
};

const encodeUnderwritingReport = (terms: OnchainTerms): `0x${string}` => {
  return encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint256" },
      { type: "bool" },
      { type: "uint16" },
      { type: "uint16" },
      { type: "uint256" },
      { type: "bytes32" },
    ],
    [
      terms.borrower,
      terms.assetId,
      terms.approved,
      terms.maxLtvBps,
      terms.rateBps,
      terms.expiry,
      terms.reasoningHash,
    ],
  );
};

const onUnderwritingRequest = async (runtime: Runtime<Config>, eventLog: EVMLog) => {
  const { underwritingRegistryAddress, rwaAssetRegistryAddress, navOracleAddress, privateApiUrl } = runtime.config;
  const chainSelector = getChainSelector(runtime.config);
  const evmClient = new cre.capabilities.EVMClient(chainSelector);

  const decodedEvent = decodeEventLog({
    abi: UNDERWRITING_EVENT_ABI,
    topics: eventLog.topics.map((topic) => bytesToHex(topic)) as [signature: `0x${string}`, ...args: `0x${string}`[]],
    data: bytesToHex(eventLog.data),
    eventName: "UnderwritingRequested",
  });

  const borrower = decodedEvent.args.borrower as Address;
  const assetId = decodedEvent.args.assetId as bigint;
  const intendedBorrowAmountFromEvent = decodedEvent.args.intendedBorrowAmount as bigint;
  const txHashHex = bytesToHex(eventLog.txHash);
  const requestId = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint32" }],
      [borrower, assetId, txHashHex, eventLog.index],
    ),
  );

  logStep(runtime, requestId, "0", "Trigger received: UnderwritingRequested log");

  if (processedRequestIds.has(requestId)) {
    logStep(runtime, requestId, "0.1", "Replay detected in runtime cache, skipping");
    logAudit(runtime, "underwriting_replay_skipped", {
      requestId,
      borrower,
      assetId: assetId.toString(),
      txHash: txHashHex,
      logIndex: eventLog.index,
    });
    return true;
  }
  processedRequestIds.add(requestId);

  logStep(runtime, requestId, "1", "Event decoded", {
    borrower,
    assetId: assetId.toString(),
    txHash: txHashHex,
    logIndex: eventLog.index,
    intendedBorrowAmountFromEvent: intendedBorrowAmountFromEvent.toString(),
  });
  logAudit(runtime, "underwriting_requested", {
    requestId,
    borrower,
    assetId: assetId.toString(),
    txHash: txHashHex,
    logIndex: eventLog.index,
  });

  logStep(runtime, requestId, "2", "Loading runtime secrets and onchain context");
  const creApiKey = getSecretValue(runtime, "CRE_API_KEY");

  const assetData = fetchOnchainAssetData(runtime, evmClient, rwaAssetRegistryAddress, assetId);
  let navSnapshot = fetchNavSnapshot(runtime, evmClient, navOracleAddress, assetId);
  const requestedBorrowAmountFromRegistry = fetchRequestedBorrowAmount(
    runtime,
    evmClient,
    underwritingRegistryAddress,
    borrower,
    assetId,
  );
  logStep(runtime, requestId, "3", "Onchain context loaded", {
    assetStatus: assetData.currentStatus,
    navIsFresh: navSnapshot.isFresh,
    nav: navSnapshot.nav.toString(),
    requestedBorrowAmountFromRegistry: requestedBorrowAmountFromRegistry.toString(),
  });

  if (requestedBorrowAmountFromRegistry === 0n) {
    logStep(runtime, requestId, "3.1", "No pending requested amount in registry, skipping");
    logAudit(runtime, "no_pending_request_skip", {
      requestId,
      borrower,
      assetId: assetId.toString(),
      intendedBorrowAmountFromEvent: intendedBorrowAmountFromEvent.toString(),
    });
    return true;
  }
  if (intendedBorrowAmountFromEvent > 0n && intendedBorrowAmountFromEvent !== requestedBorrowAmountFromRegistry) {
    logStep(runtime, requestId, "3.2", "Event amount and registry amount mismatch, proceeding with registry amount", {
      intendedBorrowAmountFromEvent: intendedBorrowAmountFromEvent.toString(),
      requestedBorrowAmountFromRegistry: requestedBorrowAmountFromRegistry.toString(),
    });
  }
  const requestedLoanAmount = requestedBorrowAmountFromRegistry;
  logStep(runtime, requestId, "4", "Fetching confidential borrower signals and public context");
  const borrowerData = fetchBorrowerData(runtime, borrower, privateApiUrl, creApiKey);
  const assetPerformance = fetchAssetPerformanceData(runtime, assetId, assetData.metadataHash, privateApiUrl, creApiKey);
  const macroData = fetchMacroData();
  logStep(runtime, requestId, "4.1", "Context fetched (private borrower data kept offchain)");

  let safetyGateReason: string | null = null;

  const deniedStatuses = new Set<number>([4, 5, 7]); // DEFAULTED, LIQUIDATING, PAUSED
  if (deniedStatuses.has(assetData.currentStatus)) {
    logAudit(runtime, "asset_status_hard_deny", {
      requestId,
      borrower,
      assetId: assetId.toString(),
      currentStatus: assetData.currentStatus,
    });
    safetyGateReason = `ASSET_STATUS_${assetData.currentStatus}`;
    logStep(runtime, requestId, "5", "Safety gate triggered: denied asset status", {
      currentStatus: assetData.currentStatus,
    });
  }

  if (!safetyGateReason && (!navSnapshot.isFresh || navSnapshot.nav === 0n)) {
    logStep(runtime, requestId, "5", "NAV stale/missing; computing and publishing NAV update");
    const navComputation = computeAndHashNav(assetId, assetData.assetValue, assetPerformance, macroData);
    const navUpdateTxHash = updateNavOnchain(
      runtime,
      evmClient,
      navOracleAddress,
      assetId,
      navComputation.nav,
      navComputation.sourceHash,
    );
    logAudit(runtime, "nav_updated_onchain", {
      requestId,
      borrower,
      assetId: assetId.toString(),
      nav: navComputation.nav.toString(),
      sourceHash: navComputation.sourceHash,
      txHash: navUpdateTxHash,
    });

    navSnapshot = fetchNavSnapshot(runtime, evmClient, navOracleAddress, assetId);
    logStep(runtime, requestId, "5.1", "NAV refresh check after update", {
      isFresh: navSnapshot.isFresh,
      nav: navSnapshot.nav.toString(),
      navUpdatedAt: navSnapshot.updatedAt.toString(),
    });

    if (!navSnapshot.isFresh || navSnapshot.nav === 0n) {
      logAudit(runtime, "stale_or_missing_nav_deny", {
        requestId,
        borrower,
        assetId: assetId.toString(),
        isFresh: navSnapshot.isFresh,
        nav: navSnapshot.nav.toString(),
        navUpdatedAt: navSnapshot.updatedAt.toString(),
      });
      safetyGateReason = "STALE_OR_MISSING_NAV";
      logStep(runtime, requestId, "5.2", "Safety gate triggered: NAV still stale after update", {
        isFresh: navSnapshot.isFresh,
        nav: navSnapshot.nav.toString(),
      });
    }
  }
  const collateralValueNumber = toSafeUsdNumber(navSnapshot.nav);
  const requestedLoanAmountNumber = toSafeUsdNumber(requestedLoanAmount);

  const aiInput: AIUnderwritingInput = {
    borrowerMetrics: borrowerData.borrowerMetrics,
    assetMetrics: assetPerformance,
    macroContext: macroData,
    requestedLoanAmount: requestedLoanAmountNumber,
    collateralValue: collateralValueNumber,
  };

  let aiOutput = safetyGateReason
    ? hardDenyOutput(
      safetyGateReason,
      runtime.config.baseRateBps,
      runtime.config.rateSpreadPerRiskTier,
    )
    : runUnderwritingPolicy(
      aiInput,
      borrowerData.compliance,
      runtime.config.baseRateBps,
      runtime.config.rateSpreadPerRiskTier,
      runtime.config.maxLtvBaseBps,
      runtime.config.maxLtvReductionPerRiskTier,
    );
  logStep(runtime, requestId, "6", "Deterministic underwriting evaluated", {
    approved: aiOutput.approved,
    riskTier: aiOutput.riskTier,
    maxLtvBps: aiOutput.maxLtvBps,
    rateBps: aiOutput.rateBps,
  });
  logAudit(runtime, "underwriting_decision", {
    requestId,
    borrower,
    assetId: assetId.toString(),
    approved: aiOutput.approved,
    riskTier: aiOutput.riskTier,
    maxLtvBps: aiOutput.maxLtvBps,
    rateBps: aiOutput.rateBps,
  });

  const maxBorrowableFromTerms = (navSnapshot.nav * BigInt(aiOutput.maxLtvBps)) / 10_000n;
  if (requestedLoanAmount > maxBorrowableFromTerms) {
    logAudit(runtime, "requested_ltv_exceeds_terms_deny", {
      requestId,
      borrower,
      assetId: assetId.toString(),
      requestedLoanAmount: requestedLoanAmount.toString(),
      maxBorrowableFromTerms: maxBorrowableFromTerms.toString(),
      maxLtvBps: aiOutput.maxLtvBps,
    });
    logStep(runtime, requestId, "7", "Requested amount exceeds max borrow from terms; forcing deny", {
      requestedLoanAmount: requestedLoanAmount.toString(),
      maxBorrowableFromTerms: maxBorrowableFromTerms.toString(),
    });
    aiOutput = hardDenyOutput(
      "REQUESTED_LTV_EXCEEDS_MAX",
      runtime.config.baseRateBps,
      runtime.config.rateSpreadPerRiskTier,
    );
  }

  const geminiApiKey = getSecretValue(runtime, "GEMINI_API_KEY");
  const riskFlags = buildRiskFlags(aiInput, aiOutput, safetyGateReason);
  logStep(runtime, requestId, "8", "Generating AI explanation (non-binding)");
  const aiExplanation = generateAIExplanation(
    runtime,
    runtime.config.aiModelName,
    geminiApiKey,
    aiInput,
    {
      approved: aiOutput.approved,
      riskTier: aiOutput.riskTier,
      maxLtvBps: aiOutput.maxLtvBps,
      rateBps: aiOutput.rateBps,
      expiry: aiOutput.expiry,
    },
    riskFlags,
  );
  aiOutput.explanation = JSON.stringify(aiExplanation);
  logStep(runtime, requestId, "8.1", "AI explanation generated and serialized");

  const terms: OnchainTerms = {
    borrower,
    assetId,
    approved: aiOutput.approved,
    maxLtvBps: aiOutput.maxLtvBps,
    rateBps: aiOutput.rateBps,
    expiry: BigInt(aiOutput.expiry),
    reasoningHash: keccak256(toHex(new TextEncoder().encode(aiOutput.explanation))),
  };
  logStep(runtime, requestId, "9", "Prepared minimal onchain terms", {
    approved: terms.approved,
    maxLtvBps: terms.maxLtvBps,
    rateBps: terms.rateBps,
    expiry: terms.expiry.toString(),
    reasoningHash: terms.reasoningHash,
  });

  try {
    postJsonWithConfidentialHttp(
      runtime,
      `${privateApiUrl}/api/explanations`,
      {
        Authorization: `Bearer ${creApiKey}`,
        "Content-Type": "application/json",
      },
      {
        hash: terms.reasoningHash,
        explanation: aiExplanation,
      },
    );
    logStep(runtime, requestId, "9.1", "AI explanation securely pushed to private API");
  } catch (err) {
    logAudit(runtime, "explanation_push_failed", {
      requestId,
      error: String(err),
    });
  }

  const encodedPayload = encodeUnderwritingReport(terms);
  logStep(runtime, requestId, "10", "Building signed CRE report");
  const report = runtime
    .report({
      encodedPayload: hexToBase64(encodedPayload),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();

  logStep(runtime, requestId, "11", "Submitting report to UnderwritingRegistry via forwarder", {
    receiver: underwritingRegistryAddress,
  });
  const writeResult = evmClient
    .writeReport(runtime, {
      receiver: underwritingRegistryAddress,
      report,
      gasConfig: runtime.config.gasLimit ? { gasLimit: runtime.config.gasLimit } : undefined,
    })
    .result();

  if (writeResult.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`Underwriting write failed with status=${writeResult.txStatus}`);
  }

  const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32));
  logStep(runtime, requestId, "12", "Report submitted successfully", {
    txHash,
    borrower,
    assetId: assetId.toString(),
    approved: aiOutput.approved,
    maxLtvBps: aiOutput.maxLtvBps,
    rateBps: aiOutput.rateBps,
  });
  logAudit(runtime, "underwriting_report_submitted", {
    requestId,
    borrower,
    assetId: assetId.toString(),
    txHash,
    approved: aiOutput.approved,
  });
  return true;
};

const onRiskMonitorCron = async (runtime: Runtime<Config>) => {
  logStep(runtime, "CRON", "1", "Starting Risk Monitor Agent");
  
  const macroData = fetchMacroData();
  logStep(runtime, "CRON", "2", "Macro data fetched", macroData as unknown as Record<string, unknown>);

  if (macroData.interestRateEnvironment === "HIGH" || macroData.propertyIndexTrend === "DECLINING") {
    logAudit(runtime, "systemic_risk_detected", {
      reason: "Adverse macro environment",
      macroData: macroData as unknown as Record<string, unknown>,
    });
    // In a full implementation, this would trigger an onchain margin call or adjust risk tiers
    // by fetching active loans and computing health factors.
    logStep(runtime, "CRON", "3", "Systemic risk detected. Alert generated.");
  } else {
    logStep(runtime, "CRON", "3", "Macro environment stable. No action required.");
  }
  return true;
};

const initWorkflow = (config: Config) => {
  const chainSelector = getChainSelector(config);
  const evmClient = new cre.capabilities.EVMClient(chainSelector);

  const eventSignature = keccak256(
    toHex("UnderwritingRequested(address,uint256,uint256)"),
  );

  const trigger = evmClient.logTrigger({
    addresses: [hexToBase64(config.underwritingRegistryAddress)],
    topics: [{ values: [hexToBase64(eventSignature)] }, { values: [] }, { values: [] }],
  });
  
  const cron = new cre.capabilities.CronCapability();
  const cronTrigger = cron.trigger({ schedule: config.schedule ?? "0 0 * * *" }); // run daily by default

  return [
    cre.handler(trigger, onUnderwritingRequest),
    cre.handler(cronTrigger, onRiskMonitorCron),
  ];
};

export async function main() {
  console.log(`CreditWeave Underwriting Workflow [${new Date().toISOString()}]`);

  const runner = await Runner.newRunner<Config>({
    configParser: (config) => JSON.parse(new TextDecoder().decode(config)) as Config,
  });
  await runner.run(initWorkflow);
}

await main();
