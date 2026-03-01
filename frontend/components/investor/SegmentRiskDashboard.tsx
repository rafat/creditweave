"use client";

import { useEffect, useState } from "react";
import { formatUnits, zeroAddress } from "viem";
import { usePublicClient, useReadContract } from "wagmi";
import {
  CONTRACTS,
  LENDING_POOL_ABI,
  PORTFOLIO_RISK_REGISTRY_ABI,
  RWA_ASSET_REGISTRY_ABI,
} from "@/lib/contracts";
import { SUPPORTED_CHAIN_ID } from "@/lib/wagmi";

type SegmentRow = {
  segmentId: `0x${string}`;
  assetCount: number;
  borrowPaused: boolean;
  ltvHaircutBps: number;
  totalExposure: bigint;
  watchlistExposure: bigint;
  delinquentExposure: bigint;
  delinquencyRateBps: number;
  watchlistRateBps: number;
  thresholdBreached: boolean;
  breachReason: `0x${string}`;
  updatedAt: bigint;
};

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

const shortHex = (value: `0x${string}`) => `${value.slice(0, 10)}...${value.slice(-8)}`;

export default function SegmentRiskDashboard() {
  const contracts = CONTRACTS[SUPPORTED_CHAIN_ID];
  const publicClient = usePublicClient({ chainId: SUPPORTED_CHAIN_ID });
  const [rows, setRows] = useState<SegmentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>("");

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
    const load = async () => {
      const registryAddress = (contracts.portfolioRiskRegistry ||
        (poolPortfolioRiskRead.data as `0x${string}` | undefined) ||
        zeroAddress) as `0x${string}`;
      const assetCounter = Number(assetCounterRead.data ?? 0n);

      if (!publicClient || registryAddress === zeroAddress || assetCounter <= 0) {
        setRows([]);
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError("");

        const segmentByAsset = new Map<`0x${string}`, number>();
        for (let i = 1; i <= assetCounter; i += 1) {
          const segment = (await publicClient.readContract({
            address: registryAddress,
            abi: PORTFOLIO_RISK_REGISTRY_ABI,
            functionName: "getSegmentForAsset",
            args: [BigInt(i)],
          })) as `0x${string}`;
          if (segment !== ZERO_SEGMENT) {
            segmentByAsset.set(segment, (segmentByAsset.get(segment) ?? 0) + 1);
          }
        }

        const segmentIds = Array.from(segmentByAsset.keys());
        const builtRows: SegmentRow[] = [];
        for (const segmentId of segmentIds) {
          const cfg = (await publicClient.readContract({
            address: registryAddress,
            abi: PORTFOLIO_RISK_REGISTRY_ABI,
            functionName: "getSegmentConfig",
            args: [segmentId],
          })) as SegmentConfigRead;

          const state = (await publicClient.readContract({
            address: registryAddress,
            abi: PORTFOLIO_RISK_REGISTRY_ABI,
            functionName: "getSegmentState",
            args: [segmentId],
          })) as SegmentStateRead;

          builtRows.push({
            segmentId,
            assetCount: segmentByAsset.get(segmentId) ?? 0,
            borrowPaused: Boolean(cfg.borrowPaused),
            ltvHaircutBps: Number(cfg.ltvHaircutBps),
            totalExposure: state.totalExposure,
            watchlistExposure: state.watchlistExposure,
            delinquentExposure: state.delinquentExposure,
            delinquencyRateBps: Number(state.delinquencyRateBps),
            watchlistRateBps: Number(state.watchlistRateBps),
            thresholdBreached: Boolean(state.thresholdBreached),
            breachReason: state.breachReason,
            updatedAt: state.updatedAt,
          });
        }

        builtRows.sort((a, b) => Number(b.totalExposure - a.totalExposure));
        setRows(builtRows);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [assetCounterRead.data, contracts.portfolioRiskRegistry, poolPortfolioRiskRead.data, publicClient]);

  return (
    <section className="rounded-2xl border bg-[color:var(--card)] p-5">
      <p className="mono text-xs text-[color:var(--ink-700)]">SEGMENT RISK DASHBOARD</p>
      {isLoading ? <p className="mt-3 text-sm text-[color:var(--ink-700)]">Loading segment risk data...</p> : null}
      {error ? (
        <p className="mt-3 rounded-lg bg-[#fdecea] px-3 py-2 text-xs text-[#8c2d25]">{error}</p>
      ) : null}
      {!isLoading && !error && rows.length === 0 ? (
        <p className="mt-3 text-sm text-[color:var(--ink-700)]">No assigned segments found.</p>
      ) : null}
      {rows.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm border-collapse">
            <thead className="mono text-xs text-[color:var(--ink-700)]">
              <tr>
                <th className="py-3 px-2">Segment</th>
                <th className="py-3 px-2">Assets</th>
                <th className="py-3 px-2">Borrow</th>
                <th className="py-3 px-2">Haircut</th>
                <th className="py-3 px-2">Total Exposure</th>
                <th className="py-3 px-2">Watchlist Rate</th>
                <th className="py-3 px-2">Delinq. Rate</th>
                <th className="py-3 px-2">Threshold</th>
                <th className="py-3 px-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.segmentId} className="border-t">
                  <td className="py-3 px-2 mono text-xs">{shortHex(row.segmentId)}</td>
                  <td className="py-3 px-2">{row.assetCount}</td>
                  <td className="py-3 px-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        row.borrowPaused ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                      }`}
                    >
                      {row.borrowPaused ? "PAUSED" : "OPEN"}
                    </span>
                  </td>
                  <td className="py-3 px-2">{(row.ltvHaircutBps / 100).toFixed(2)}%</td>
                  <td className="py-3 px-2">${Number(formatUnits(row.totalExposure, 18)).toLocaleString()}</td>
                  <td className="py-3 px-2">{(row.watchlistRateBps / 100).toFixed(2)}%</td>
                  <td className="py-3 px-2">{(row.delinquencyRateBps / 100).toFixed(2)}%</td>
                  <td className="py-3 px-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        row.thresholdBreached ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {row.thresholdBreached ? "BREACHED" : "OK"}
                    </span>
                  </td>
                  <td className="py-3 px-2 mono text-xs">
                    {row.breachReason !== ZERO_SEGMENT ? shortHex(row.breachReason) : "N/A"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
