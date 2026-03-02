"use client";

import { formatUnits } from "viem";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, useReadContract } from "wagmi";
import {
  CONTRACTS,
  ERC20_ABI,
  LENDING_POOL_ABI,
  NAV_ORACLE_ABI,
  PORTFOLIO_RISK_REGISTRY_ABI,
  RWA_ASSET_REGISTRY_ABI,
  UNDERWRITING_REGISTRY_V2_ABI,
} from "@/lib/contracts";
import { SUPPORTED_CHAIN_ID } from "@/lib/wagmi";

const toBigInt = (value: string): bigint | null => {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
};

export default function AssetOverview() {
  const [mounted, setMounted] = useState(false);
  const contracts = CONTRACTS[SUPPORTED_CHAIN_ID];
  const { address } = useAccount();
  const chainId = useChainId();
  const [assetIdInput, setAssetIdInput] = useState("1");
  const assetId = useMemo(() => toBigInt(assetIdInput), [assetIdInput]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 1. Discover total number of assets
  const counterRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.rwaAssetRegistry,
    abi: RWA_ASSET_REGISTRY_ABI,
    functionName: "assetCounter",
    query: {
      refetchInterval: 300_000, // 5 minutes
    },
  });

  const assetCounter = Number(counterRead.data ?? 0);

  const assetCoreRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.rwaAssetRegistry,
    abi: RWA_ASSET_REGISTRY_ABI,
    functionName: "getAssetCore",
    args: assetId !== null ? [assetId] : undefined,
    query: {
      enabled: assetId !== null && assetId > 0n,
      refetchInterval: 300_000, // 5 minutes
    },
  });

  const navFreshRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.navOracle,
    abi: NAV_ORACLE_ABI,
    functionName: "isFresh",
    args: assetId !== null ? [assetId] : undefined,
    query: {
      enabled: assetId !== null && assetId > 0n,
      refetchInterval: 300_000, // 5 minutes
    },
  });

  const navDataRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.navOracle,
    abi: NAV_ORACLE_ABI,
    functionName: "getNAVData",
    args: assetId !== null ? [assetId] : undefined,
    query: {
      enabled: assetId !== null && assetId > 0n,
      refetchInterval: 300_000, // 5 minutes
    },
  });

  const underwritingV2Address = contracts.underwritingRegistryV2 ?? contracts.activeUnderwritingRegistry;
  const v2LoanProductRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: underwritingV2Address,
    abi: UNDERWRITING_REGISTRY_V2_ABI,
    functionName: "getAssetLoanProduct",
    args: assetId !== null ? [assetId] : [0n],
    query: {
      enabled: contracts.usesUnderwritingV2 && assetId !== null && assetId > 0n,
      refetchInterval: 300_000,
    },
  });

  const v2DecisionRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: underwritingV2Address,
    abi: UNDERWRITING_REGISTRY_V2_ABI,
    functionName: "getDecision",
    args: address && assetId !== null ? [address, assetId] : undefined,
    query: {
      enabled: Boolean(contracts.usesUnderwritingV2 && address && assetId !== null && assetId > 0n),
      refetchInterval: 30_000,
    },
  });

  const v2ApprovedRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: underwritingV2Address,
    abi: UNDERWRITING_REGISTRY_V2_ABI,
    functionName: "isApproved",
    args: address && assetId !== null ? [address, assetId] : undefined,
    query: {
      enabled: Boolean(contracts.usesUnderwritingV2 && address && assetId !== null && assetId > 0n),
      refetchInterval: 30_000,
    },
  });

  const v2BorrowingTermsRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: underwritingV2Address,
    abi: UNDERWRITING_REGISTRY_V2_ABI,
    functionName: "getBorrowingTerms",
    args: address && assetId !== null ? [address, assetId] : undefined,
    query: {
      enabled: Boolean(contracts.usesUnderwritingV2 && address && assetId !== null && assetId > 0n),
      refetchInterval: 30_000,
    },
  });

  const tokenAddressRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.lendingPool,
    abi: LENDING_POOL_ABI,
    functionName: "assetIdToToken",
    args: assetId !== null ? [assetId] : [0n],
    query: {
      enabled: Boolean(assetId !== null && assetId > 0n),
      refetchInterval: 30_000,
    },
  });
  const tokenAddress = tokenAddressRead.data as `0x${string}` | undefined;

  const walletShareBalanceRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(address && tokenAddress && tokenAddress !== "0x0000000000000000000000000000000000000000"),
      refetchInterval: 30_000,
    },
  });

  const portfolioRiskRegistryAddress = contracts.portfolioRiskRegistry;
  const hasPortfolioRiskRegistry =
    Boolean(portfolioRiskRegistryAddress) &&
    portfolioRiskRegistryAddress !== "0x0000000000000000000000000000000000000000";

  const segmentIdRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: portfolioRiskRegistryAddress,
    abi: PORTFOLIO_RISK_REGISTRY_ABI,
    functionName: "getSegmentForAsset",
    args: assetId !== null ? [assetId] : [0n],
    query: {
      enabled: Boolean(hasPortfolioRiskRegistry && assetId !== null && assetId > 0n),
      refetchInterval: 300_000,
    },
  });

  const segmentId = segmentIdRead.data as `0x${string}` | undefined;
  const hasSegment = Boolean(segmentId && !/^0x0+$/.test(segmentId));
  const segmentConfigRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: portfolioRiskRegistryAddress,
    abi: PORTFOLIO_RISK_REGISTRY_ABI,
    functionName: "getSegmentConfig",
    args: hasSegment ? [segmentId as `0x${string}`] : [`0x${"0".repeat(64)}`],
    query: {
      enabled: Boolean(hasPortfolioRiskRegistry && hasSegment),
      refetchInterval: 300_000,
    },
  });

  const assetCore =
    (assetCoreRead.data as
      | [bigint, number, `0x${string}`, number, bigint, bigint]
      | undefined) ??
    [0n, 0, "0x0000000000000000000000000000000000000000", 0, 0n, 0n];
  const navData =
    (navDataRead.data as [bigint, bigint, `0x${string}`] | undefined) ?? [0n, 0n, "0x0"];
  const loanProductRaw = Number(v2LoanProductRead.data ?? 0n);
  const loanProductLabel =
    loanProductRaw === 1 ? "BRIDGE" :
    loanProductRaw === 2 ? "STABILIZED_TERM" :
    loanProductRaw === 3 ? "CONSTRUCTION_LITE" : "UNSPECIFIED";
  const segmentConfig = segmentConfigRead.data as
    | [boolean, boolean, number, bigint, number, number]
    | undefined;
  const segmentBorrowPaused = segmentConfig ? Boolean(segmentConfig[1]) : false;
  const segmentHaircutBps = segmentConfig ? Number(segmentConfig[2]) : 0;
  const decision = v2DecisionRead.data as { status?: number; 1?: number } | undefined;
  const decisionStatus = Number(decision?.status ?? decision?.[1] ?? -1);
  const isApproved = Boolean(v2ApprovedRead.data);
  const borrowingTerms = v2BorrowingTermsRead.data as [number, number, bigint, bigint] | undefined;
  const expiry = borrowingTerms?.[3] ?? 0n;
  const isExpired = expiry > 0n && expiry <= BigInt(Math.floor(Date.now() / 1000));
  const shareBalance = (walletShareBalanceRead.data as bigint | undefined) ?? 0n;
  const hasShares = shareBalance > 0n;
  const hasConnectedWallet = Boolean(address);
  const canNavigateToBorrower = hasConnectedWallet && hasShares && chainId === SUPPORTED_CHAIN_ID;

  let underwritingLabel = "No decision yet";
  if (decisionStatus === 3) underwritingLabel = "Denied";
  else if (isApproved && isExpired) underwritingLabel = "Expired";
  else if (isApproved) underwritingLabel = "Approved";
  else if (decisionStatus >= 0) underwritingLabel = "Not currently approved";

  let nextAction = "Connect wallet to continue.";
  if (hasConnectedWallet && !hasShares) nextAction = "You need property shares in this wallet first.";
  else if (hasConnectedWallet && hasShares && !isApproved) nextAction = "Request underwriting before borrowing.";
  else if (hasConnectedWallet && hasShares && isExpired) nextAction = "Terms expired. Request underwriting refresh.";
  else if (canNavigateToBorrower) nextAction = "Use as collateral, then deposit and borrow.";

  if (!mounted) return null;

  const isLoading = assetCoreRead.isLoading || navFreshRead.isLoading || navDataRead.isLoading;
  const isError = (assetCoreRead.isError && assetId !== 0n) || navFreshRead.isError || navDataRead.isError;
  const errorMessage =
    assetCoreRead.error?.message ?? navFreshRead.error?.message ?? navDataRead.error?.message;

  return (
    <section className="rounded-2xl border bg-[color:var(--card)] p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="mono text-xs text-[color:var(--ink-700)]">ASSET OVERVIEW</p>
        
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500">Select Asset:</label>
          {assetCounter > 0 ? (
            <select
              className="rounded-lg border bg-white px-3 py-1.5 text-sm font-medium shadow-sm outline-none focus:ring-2 focus:ring-[color:var(--mint-500)]"
              value={assetIdInput}
              onChange={(e) => setAssetIdInput(e.target.value)}
            >
              {Array.from({ length: assetCounter }, (_, i) => i + 1).map((id) => (
                <option key={id} value={id}>
                  Asset #{id}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-gray-400 italic">No assets registered</span>
          )}
        </div>
      </div>
      {isLoading ? (
        <p className="mt-3 text-sm text-[color:var(--ink-700)]">Loading asset metrics...</p>
      ) : null}
      {isError ? (
        <p className="mt-3 rounded-lg bg-[#fdecea] px-3 py-2 text-xs text-[#8c2d25]">
          {errorMessage ?? "Failed to load asset metrics."}
        </p>
      ) : null}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <article className="rounded-xl border p-4 text-sm">
          <p className="flex justify-between">
            <span>Asset ID</span>
            <span className="mono">#{assetCore[0].toString()}</span>
          </p>
          <p className="mt-2 flex justify-between">
            <span>Status</span>
            <span className="mono">{assetCore[3]}</span>
          </p>
          <p className="mt-2 flex justify-between">
            <span>Asset Value</span>
            <span className="mono">{formatUnits(assetCore[4], 18)}</span>
          </p>
          <p className="mt-2 flex justify-between">
            <span>Accumulated Yield</span>
            <span className="mono">{formatUnits(assetCore[5], 18)}</span>
          </p>
          <p className="mt-2 flex justify-between">
            <span>V2 Loan Product</span>
            <span className="mono">{loanProductLabel}</span>
          </p>
        </article>
        <article className="rounded-xl border p-4 text-sm">
          <p className="flex justify-between">
            <span>NAV Fresh</span>
            <span className="mono">{navFreshRead.data ? "yes" : "no"}</span>
          </p>
          <p className="mt-2 flex justify-between">
            <span>NAV</span>
            <span className="mono">{formatUnits(navData[0], 18)}</span>
          </p>
          <p className="mt-2 flex justify-between">
            <span>Updated At</span>
            <span className="mono">
              {navData[1] > 0n
                ? new Date(Number(navData[1]) * 1000).toISOString().slice(0, 19).replace("T", " ")
                : "N/A"}
            </span>
          </p>
          <p className="mono mt-2 truncate text-xs text-[color:var(--ink-700)]">
            Source Hash: {navData[2]}
          </p>
          <p className="mono mt-2 truncate text-xs text-[color:var(--ink-700)]">
            Segment ID: {hasSegment ? segmentId : "UNASSIGNED"}
          </p>
          <p className="mt-2 flex justify-between text-xs">
            <span>Segment Borrow Paused</span>
            <span className="mono">{segmentBorrowPaused ? "yes" : "no"}</span>
          </p>
          <p className="mt-2 flex justify-between text-xs">
            <span>Segment Haircut</span>
            <span className="mono">{(segmentHaircutBps / 100).toFixed(2)}%</span>
          </p>
        </article>
      </div>
      <div className="mt-3 rounded-xl border p-4">
        <p className="mono text-xs text-[color:var(--ink-700)]">USE AS COLLATERAL</p>
        <p className="mt-2 text-sm">
          Your wallet share balance: <span className="mono">{formatUnits(shareBalance, 18)}</span>
        </p>
        <p className="mt-1 text-sm">
          Underwriting status: <span className="mono">{underwritingLabel}</span>
        </p>
        <p className="mt-1 text-xs text-[color:var(--ink-700)]">{nextAction}</p>
        <Link
          href={`/borrower?assetId=${assetIdInput}`}
          aria-disabled={!canNavigateToBorrower}
          className={`mt-3 inline-flex rounded-lg px-3 py-2 text-sm font-medium ${
            canNavigateToBorrower
              ? "bg-[color:var(--mint-500)] text-white hover:opacity-90"
              : "cursor-not-allowed border bg-gray-100 text-gray-400"
          }`}
          onClick={(e) => {
            if (!canNavigateToBorrower) e.preventDefault();
          }}
        >
          Use as Collateral
        </Link>
      </div>
    </section>
  );
}
