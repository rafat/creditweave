import {
  bytesToHex,
  consensusIdenticalAggregation,
  cre,
  decodeJson,
  encodeCallMsg,
  EVMClient,
  type EVMLog,
  hexToBase64,
  LAST_FINALIZED_BLOCK_NUMBER,
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
              body: {
                case: "bodyBytes" as const,
                value: new TextEncoder().encode(requestBody),
              },
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
): { assetValue: bigint; currentStatus: number } => {
  const callData = encodeFunctionData({
    abi: ASSET_REGISTRY_ABI,
    functionName: "getAssetCore",
    args: [assetId],
  });

  const result = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: registryAddress,
        data: callData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();

  const decoded = decodeFunctionResult({
    abi: ASSET_REGISTRY_ABI,
    functionName: "getAssetCore",
    data: bytesToHex(result.data),
  });

  return {
    assetValue: decoded[4],
    currentStatus: Number(decoded[3]),
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
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
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
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
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
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
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

    const financials = fetchJsonWithConfidentialHttp(
      runtime,
      `${privateApiUrl}/api/financials/${borrower}`,
      authHeaders,
    ) as Record<string, number>;

    const credit = fetchJsonWithConfidentialHttp(
      runtime,
      `${privateApiUrl}/api/credit/${borrower}`,
      authHeaders,
    ) as Record<string, number | boolean>;

    const compliance = fetchJsonWithConfidentialHttp(
      runtime,
      `${privateApiUrl}/api/compliance/${borrower}`,
      authHeaders,
    ) as Record<string, boolean>;

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

const fetchAssetPerformanceData = (): AssetMetrics => {
  return {
    cashflowHealth: "PERFORMING",
    navVolatility: 0.04,
    rentalCoverageRatio: 1.35,
    propertyAgeYears: 5,
    occupancyRate: 0.95,
    marketAppreciation1Y: 0.03,
  };
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
  const cashflowScoreByHealth: Record<AssetMetrics["cashflowHealth"], number> = {
    PERFORMING: 1,
    GRACE_PERIOD: 0.7,
    LATE: 0.4,
    DEFAULTED: 0,
  };
  const cashflowScore = cashflowScoreByHealth[input.assetMetrics.cashflowHealth];

  const borrowerScore =
    input.borrowerMetrics.incomeStabilityScore * 0.25 +
    input.borrowerMetrics.creditRiskScore * 0.3 +
    (1 - input.borrowerMetrics.debtToIncome) * 0.25 +
    input.borrowerMetrics.pastRepaymentScore * 0.2;

  const assetScore =
    cashflowScore * 0.4 +
    (1 - input.assetMetrics.navVolatility) * 0.2 +
    Math.min(1, input.assetMetrics.rentalCoverageRatio / 1.5) * 0.25 +
    input.assetMetrics.occupancyRate * 0.15;

  const compositeScore = borrowerScore * 0.6 + assetScore * 0.4;

  let riskTier: number;
  if (compositeScore >= 0.85) riskTier = 1;
  else if (compositeScore >= 0.75) riskTier = 2;
  else if (compositeScore >= 0.65) riskTier = 3;
  else if (compositeScore >= 0.55) riskTier = 4;
  else riskTier = 5;

  if (input.assetMetrics.navVolatility > 0.1) {
    riskTier = Math.min(5, riskTier + 1);
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
    explanation: `Deterministic underwriting: score=${compositeScore.toFixed(4)}, tier=${riskTier}`,
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
    "You are an institutional credit risk analyst for a regulated onchain RWA lending protocol.",
    "Do not override deterministic decisions.",
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

  if (processedRequestIds.has(requestId)) {
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

  runtime.log(`Processing UnderwritingRequested borrower=${borrower}, assetId=${assetId.toString()}`);
  logAudit(runtime, "underwriting_requested", {
    requestId,
    borrower,
    assetId: assetId.toString(),
    txHash: txHashHex,
    logIndex: eventLog.index,
  });

  const creApiKey = getSecretValue(runtime, "CRE_API_KEY");

  const assetData = fetchOnchainAssetData(runtime, evmClient, rwaAssetRegistryAddress, assetId);
  const navSnapshot = fetchNavSnapshot(runtime, evmClient, navOracleAddress, assetId);
  const requestedBorrowAmountFromRegistry = fetchRequestedBorrowAmount(
    runtime,
    evmClient,
    underwritingRegistryAddress,
    borrower,
    assetId,
  );
  if (requestedBorrowAmountFromRegistry === 0n) {
    logAudit(runtime, "no_pending_request_skip", {
      requestId,
      borrower,
      assetId: assetId.toString(),
      intendedBorrowAmountFromEvent: intendedBorrowAmountFromEvent.toString(),
    });
    return true;
  }
  if (intendedBorrowAmountFromEvent > 0n && intendedBorrowAmountFromEvent !== requestedBorrowAmountFromRegistry) {
    logAudit(runtime, "requested_borrow_amount_mismatch_skip", {
      requestId,
      borrower,
      assetId: assetId.toString(),
      intendedBorrowAmountFromEvent: intendedBorrowAmountFromEvent.toString(),
      requestedBorrowAmountFromRegistry: requestedBorrowAmountFromRegistry.toString(),
    });
    return true;
  }
  const requestedLoanAmount = requestedBorrowAmountFromRegistry;
  const borrowerData = fetchBorrowerData(runtime, borrower, privateApiUrl, creApiKey);
  const assetPerformance = fetchAssetPerformanceData();
  const macroData = fetchMacroData();

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
  }

  if (!safetyGateReason && (!navSnapshot.isFresh || navSnapshot.nav === 0n)) {
    logAudit(runtime, "stale_or_missing_nav_deny", {
      requestId,
      borrower,
      assetId: assetId.toString(),
      isFresh: navSnapshot.isFresh,
      nav: navSnapshot.nav.toString(),
      navUpdatedAt: navSnapshot.updatedAt.toString(),
    });
    safetyGateReason = "STALE_OR_MISSING_NAV";
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
    aiOutput = hardDenyOutput(
      "REQUESTED_LTV_EXCEEDS_MAX",
      runtime.config.baseRateBps,
      runtime.config.rateSpreadPerRiskTier,
    );
  }

  const geminiApiKey = getSecretValue(runtime, "GEMINI_API_KEY");
  const riskFlags = buildRiskFlags(aiInput, aiOutput, safetyGateReason);
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

  const terms: OnchainTerms = {
    borrower,
    assetId,
    approved: aiOutput.approved,
    maxLtvBps: aiOutput.maxLtvBps,
    rateBps: aiOutput.rateBps,
    expiry: BigInt(aiOutput.expiry),
    reasoningHash: keccak256(toHex(new TextEncoder().encode(aiOutput.explanation))),
  };

  const encodedPayload = encodeUnderwritingReport(terms);
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
      receiver: underwritingRegistryAddress,
      report,
      gasConfig: runtime.config.gasLimit ? { gasLimit: runtime.config.gasLimit } : undefined,
    })
    .result();

  if (writeResult.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`Underwriting write failed with status=${writeResult.txStatus}`);
  }

  const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32));
  runtime.log(
    `Submitted report tx=${txHash}, borrower=${borrower}, assetId=${assetId.toString()}, approved=${aiOutput.approved}, ltv=${aiOutput.maxLtvBps}, rate=${aiOutput.rateBps}`,
  );
  logAudit(runtime, "underwriting_report_submitted", {
    requestId,
    borrower,
    assetId: assetId.toString(),
    txHash,
    approved: aiOutput.approved,
  });
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

  return [cre.handler(trigger, onUnderwritingRequest)];
};

export async function main() {
  console.log(`CreditWeave Underwriting Workflow [${new Date().toISOString()}]`);

  const runner = await Runner.newRunner<Config>({
    configParser: (config) => JSON.parse(new TextDecoder().decode(config)) as Config,
  });
  await runner.run(initWorkflow);
}

await main();
