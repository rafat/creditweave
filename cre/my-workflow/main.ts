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
  "event UnderwritingRequested(address indexed borrower, uint256 indexed assetId)",
]);

const ASSET_REGISTRY_ABI = parseAbi([
  "function getAssetCore(uint256) view returns (uint256 assetId, uint8 assetType, address originator, uint8 currentStatus, uint256 assetValue, uint256 accumulatedYield)",
]);

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

interface OnchainTerms {
  borrower: Address;
  assetId: bigint;
  approved: boolean;
  maxLtvBps: number;
  rateBps: number;
  expiry: bigint;
  reasoningHash: `0x${string}`;
}

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
  const borrowerScore =
    input.borrowerMetrics.incomeStabilityScore * 0.25 +
    input.borrowerMetrics.creditRiskScore * 0.3 +
    (1 - input.borrowerMetrics.debtToIncome) * 0.25 +
    input.borrowerMetrics.pastRepaymentScore * 0.2;

  const assetScore =
    1 * 0.4 +
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

  const approved = riskTier <= 4;
  const maxLtvBps = Math.max(0, maxLtvBaseBps - (riskTier - 1) * maxLtvReductionPerRiskTier);
  const rateBps = baseRateBps + (riskTier - 1) * rateSpreadPerRiskTier;
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
  const { underwritingRegistryAddress, rwaAssetRegistryAddress, privateApiUrl } = runtime.config;
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

  runtime.log(`Processing UnderwritingRequested borrower=${borrower}, assetId=${assetId.toString()}`);
  logAudit(runtime, "underwriting_requested", {
    borrower,
    assetId: assetId.toString(),
  });

  const creApiKey = getSecretValue(runtime, "CRE_API_KEY");

  const assetData = fetchOnchainAssetData(runtime, evmClient, rwaAssetRegistryAddress, assetId);
  const borrowerData = fetchBorrowerData(runtime, borrower, privateApiUrl, creApiKey);
  const assetPerformance = fetchAssetPerformanceData();
  const macroData = fetchMacroData();

  const collateralValueNumber = toSafeUsdNumber(assetData.assetValue);
  const requestedLoanAmount = collateralValueNumber * 0.7;

  const aiInput: AIUnderwritingInput = {
    borrowerMetrics: borrowerData.borrowerMetrics,
    assetMetrics: assetPerformance,
    macroContext: macroData,
    requestedLoanAmount,
    collateralValue: collateralValueNumber,
  };

  const aiOutput = runUnderwritingPolicy(
    aiInput,
    borrowerData.compliance,
    runtime.config.baseRateBps,
    runtime.config.rateSpreadPerRiskTier,
    runtime.config.maxLtvBaseBps,
    runtime.config.maxLtvReductionPerRiskTier,
  );
  logAudit(runtime, "underwriting_decision", {
    borrower,
    assetId: assetId.toString(),
    approved: aiOutput.approved,
    riskTier: aiOutput.riskTier,
    maxLtvBps: aiOutput.maxLtvBps,
    rateBps: aiOutput.rateBps,
  });

  const terms: OnchainTerms = {
    borrower,
    assetId,
    approved: aiOutput.approved,
    maxLtvBps: aiOutput.maxLtvBps,
    rateBps: aiOutput.rateBps,
    expiry: BigInt(aiOutput.expiry),
    reasoningHash: keccak256(toHex(aiOutput.explanation)),
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
    toHex("UnderwritingRequested(address,uint256)"),
  );

  const trigger = evmClient.logTrigger({
    addresses: [hexToBase64(config.underwritingRegistryAddress)],
    topics: [{ values: [hexToBase64(eventSignature)] }, { values: [] }, { values: [] }, { values: [] }],
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
