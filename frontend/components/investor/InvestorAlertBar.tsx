"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits, zeroAddress } from "viem";
import { usePublicClient, useReadContract } from "wagmi";
import {
  CONTRACTS,
  LENDING_POOL_ABI,
  PORTFOLIO_RISK_REGISTRY_ABI,
  RWA_ASSET_REGISTRY_ABI,
} from "@/lib/contracts";
import { SUPPORTED_CHAIN_ID } from "@/lib/wagmi";

type Alert = { level: "critical" | "warning"; message: string };

type SegmentConfigRead = {
  exists: boolean;
  borrowPaused: boolean;
  ltvHaircutBps: number;
  maxExposure: bigint;
  maxDelinquencyBps: number;
  maxWatchlistBps: number;
};

type SegmentStateRead = {
  totalExposure: bigint;
  watchlistExposure: bigint;
  delinquentExposure: bigint;
  delinquencyRateBps: number;
  watchlistRateBps: number;
  thresholdBreached: boolean;
  breachReason: `0x${string}`;
  updatedAt: bigint;
};

const ZERO_SEGMENT = `0x${"0".repeat(64)}` as `0x${string}`;

export default function InvestorAlertBar() {
  const contracts = CONTRACTS[SUPPORTED_CHAIN_ID];
  const publicClient = usePublicClient({ chainId: SUPPORTED_CHAIN_ID });
  const [segmentAlerts, setSegmentAlerts] = useState<Alert[]>([]);

  const totalLossRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.lendingPool,
    abi: LENDING_POOL_ABI,
    functionName: "totalProtocolLoss",
    query: { refetchInterval: 30_000 },
  });

  const reserveRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.lendingPool,
    abi: LENDING_POOL_ABI,
    functionName: "reserveBalance",
    query: { refetchInterval: 30_000 },
  });

  const assetCounterRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.rwaAssetRegistry,
    abi: RWA_ASSET_REGISTRY_ABI,
    functionName: "assetCounter",
    query: { refetchInterval: 30_000 },
  });

  const poolPortfolioRiskRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.lendingPool,
    abi: LENDING_POOL_ABI,
    functionName: "portfolioRiskRegistry",
    query: { refetchInterval: 30_000 },
  });

  useEffect(() => {
    const loadSegmentAlerts = async () => {
      const registryAddress = (contracts.portfolioRiskRegistry ||
        (poolPortfolioRiskRead.data as `0x${string}` | undefined) ||
        zeroAddress) as `0x${string}`;
      const assetCounter = Number(assetCounterRead.data ?? 0n);

      if (!publicClient || registryAddress === zeroAddress || assetCounter <= 0) {
        setSegmentAlerts([]);
        return;
      }

      try {
        const uniqueSegments = new Set<`0x${string}`>();
        for (let i = 1; i <= assetCounter; i += 1) {
          const segment = (await publicClient.readContract({
            address: registryAddress,
            abi: PORTFOLIO_RISK_REGISTRY_ABI,
            functionName: "getSegmentForAsset",
            args: [BigInt(i)],
          })) as `0x${string}`;
          if (segment !== ZERO_SEGMENT) uniqueSegments.add(segment);
        }

        const alerts: Alert[] = [];
        for (const segment of uniqueSegments) {
          const cfg = (await publicClient.readContract({
            address: registryAddress,
            abi: PORTFOLIO_RISK_REGISTRY_ABI,
            functionName: "getSegmentConfig",
            args: [segment],
          })) as SegmentConfigRead;

          const state = (await publicClient.readContract({
            address: registryAddress,
            abi: PORTFOLIO_RISK_REGISTRY_ABI,
            functionName: "getSegmentState",
            args: [segment],
          })) as SegmentStateRead;

          if (cfg.borrowPaused) {
            alerts.push({
              level: "warning",
              message: `Segment ${segment.slice(0, 8)}... is borrow-paused`,
            });
          }
          if (state.thresholdBreached) {
            alerts.push({
              level: "critical",
              message: `Segment ${segment.slice(0, 8)}... threshold breached`,
            });
          }
        }

        setSegmentAlerts(alerts);
      } catch {
        setSegmentAlerts([]);
      }
    };

    void loadSegmentAlerts();
  }, [assetCounterRead.data, contracts.portfolioRiskRegistry, poolPortfolioRiskRead.data, publicClient]);

  const alerts = useMemo(() => {
    const list: Alert[] = [];
    const totalLoss = (totalLossRead.data as bigint | undefined) ?? 0n;
    const reserve = (reserveRead.data as bigint | undefined) ?? 0n;

    if (totalLoss > 0n) {
      list.push({
        level: "critical",
        message: `Protocol loss detected: $${Number(formatUnits(totalLoss, 18)).toLocaleString()}`,
      });
    }
    if (reserve === 0n) {
      list.push({
        level: "warning",
        message: "Reserve balance is zero",
      });
    }

    return [...list, ...segmentAlerts];
  }, [reserveRead.data, segmentAlerts, totalLossRead.data]);

  const criticalCount = alerts.filter((a) => a.level === "critical").length;
  const warningCount = alerts.filter((a) => a.level === "warning").length;

  if (alerts.length === 0) {
    return (
      <section className="rounded-2xl border bg-emerald-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-emerald-800">All core risk monitors normal.</p>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
              CRITICAL 0
            </span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
              WARNING 0
            </span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border bg-[color:var(--card)] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="mono text-xs text-[color:var(--ink-700)]">EXCEPTION ALERTS</p>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
            CRITICAL {criticalCount}
          </span>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
            WARNING {warningCount}
          </span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {alerts.map((alert, idx) => (
          <span
            key={`${alert.message}-${idx}`}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              alert.level === "critical"
                ? "bg-red-100 text-red-700"
                : "bg-amber-100 text-amber-700"
            }`}
          >
            {alert.message}
          </span>
        ))}
      </div>
    </section>
  );
}
