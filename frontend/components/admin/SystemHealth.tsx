"use client";

import { useCallback, useEffect, useState } from "react";
import { parseAbiItem } from "viem";
import { useChainId, usePublicClient } from "wagmi";
import { CONTRACTS } from "@/lib/contracts";
import { SUPPORTED_CHAIN_ID } from "@/lib/wagmi";

type HealthState = "healthy" | "degraded" | "unknown";

type ApiHealth = {
  state: HealthState;
  detail: string;
  latencyMs?: number;
};

type CreSignal = {
  state: HealthState;
  detail: string;
  blockNumber?: bigint;
  txHash?: string;
};

const UNDERWRITING_UPDATED_EVENT = parseAbiItem(
  "event UnderwritingUpdated(address indexed borrower, uint256 indexed assetId, bool approved, uint16 maxLtvBps, uint16 rateBps, uint256 expiry, bytes32 reasoningHash)",
);

const getApiHealth = async (baseUrl: string): Promise<ApiHealth> => {
  const start = Date.now();
  const response = await fetch(`${baseUrl}/health`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const latencyMs = Date.now() - start;

  if (!response.ok) {
    return {
      state: "degraded",
      detail: `HTTP ${response.status}`,
      latencyMs,
    };
  }

  return {
    state: "healthy",
    detail: "Healthy",
    latencyMs,
  };
};

const stateBadge = (state: HealthState): string => {
  if (state === "healthy") return "bg-[color:var(--mint-100)] text-[color:var(--mint-500)]";
  if (state === "degraded") return "bg-[#fdecea] text-[#8c2d25]";
  return "bg-gray-100 text-gray-600";
};

export default function SystemHealth() {
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: SUPPORTED_CHAIN_ID });
  const contracts = CONTRACTS[SUPPORTED_CHAIN_ID];

  const [apiHealth, setApiHealth] = useState<ApiHealth>({
    state: "unknown",
    detail: "Not checked",
  });
  const [creSignal, setCreSignal] = useState<CreSignal>({
    state: "unknown",
    detail: "Not checked",
  });
  const [lastCheckedAt, setLastCheckedAt] = useState<string>("Never");

  const refreshHealth = useCallback(async () => {
    const privateApiUrl =
      process.env.NEXT_PUBLIC_PRIVATE_API_URL ?? "http://localhost:3001";

    try {
      const apiResult = await getApiHealth(privateApiUrl);
      setApiHealth(apiResult);
    } catch (error) {
      setApiHealth({
        state: "degraded",
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    if (!publicClient) {
      setCreSignal({
        state: "unknown",
        detail: "Public client unavailable",
      });
      setLastCheckedAt(new Date().toISOString());
      return;
    }

    try {
      const latestBlock = await publicClient.getBlockNumber();
      const fromBlock = latestBlock > 5000n ? latestBlock - 5000n : 0n;

      const logs = await publicClient.getLogs({
        address: contracts.underwritingRegistry,
        event: UNDERWRITING_UPDATED_EVENT,
        fromBlock,
        toBlock: "latest",
      });

      if (logs.length === 0) {
        setCreSignal({
          state: "degraded",
          detail: "No recent UnderwritingUpdated events",
        });
      } else {
        const lastLog = logs[logs.length - 1];
        setCreSignal({
          state: "healthy",
          detail: "Recent underwriting event observed",
          blockNumber: lastLog.blockNumber,
          txHash: lastLog.transactionHash,
        });
      }
    } catch (error) {
      setCreSignal({
        state: "degraded",
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    setLastCheckedAt(new Date().toISOString());
  }, [contracts.underwritingRegistry, publicClient]);

  useEffect(() => {
    refreshHealth();
    const interval = setInterval(refreshHealth, 20_000);
    return () => clearInterval(interval);
  }, [refreshHealth]);

  return (
    <section className="rounded-2xl border bg-[color:var(--card)] p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="mono text-xs text-[color:var(--ink-700)]">SYSTEM HEALTH</p>
        <button
          type="button"
          onClick={refreshHealth}
          className="rounded-lg border bg-white px-3 py-1.5 text-xs transition hover:bg-[color:var(--mint-100)]"
        >
          Refresh
        </button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <article className="rounded-xl border p-4">
          <p className="mono text-xs text-[color:var(--ink-700)]">CHAIN</p>
          <p className="mt-2 text-sm">
            Current: <span className="mono">{chainId}</span>
          </p>
          <span
            className={`mt-2 inline-block rounded-full px-2 py-1 text-xs font-medium ${stateBadge(
              chainId === SUPPORTED_CHAIN_ID ? "healthy" : "degraded",
            )}`}
          >
            {chainId === SUPPORTED_CHAIN_ID ? "Sepolia Connected" : "Wrong Network"}
          </span>
        </article>

        <article className="rounded-xl border p-4">
          <p className="mono text-xs text-[color:var(--ink-700)]">PRIVATE API</p>
          <p className="mt-2 text-sm">
            {apiHealth.detail}
            {apiHealth.latencyMs !== undefined ? ` (${apiHealth.latencyMs} ms)` : ""}
          </p>
          <span
            className={`mt-2 inline-block rounded-full px-2 py-1 text-xs font-medium ${stateBadge(
              apiHealth.state,
            )}`}
          >
            {apiHealth.state.toUpperCase()}
          </span>
        </article>

        <article className="rounded-xl border p-4">
          <p className="mono text-xs text-[color:var(--ink-700)]">CRE SIGNAL</p>
          <p className="mt-2 text-sm">{creSignal.detail}</p>
          {creSignal.blockNumber !== undefined && (
            <p className="mono mt-1 text-xs text-[color:var(--ink-700)]">
              Block: {creSignal.blockNumber.toString()}
            </p>
          )}
          {creSignal.txHash && (
            <p className="mono mt-1 truncate text-xs text-[color:var(--ink-700)]">
              Tx: {creSignal.txHash}
            </p>
          )}
          <span
            className={`mt-2 inline-block rounded-full px-2 py-1 text-xs font-medium ${stateBadge(
              creSignal.state,
            )}`}
          >
            {creSignal.state.toUpperCase()}
          </span>
        </article>
      </div>

      <p className="mono mt-3 text-xs text-[color:var(--ink-700)]">
        Last checked: {lastCheckedAt}
      </p>
    </section>
  );
}
