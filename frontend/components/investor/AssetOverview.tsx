"use client";

import { formatUnits } from "viem";
import { useMemo, useState } from "react";
import { useReadContract } from "wagmi";
import {
  CONTRACTS,
  NAV_ORACLE_ABI,
  RWA_ASSET_REGISTRY_ABI,
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
  const contracts = CONTRACTS[SUPPORTED_CHAIN_ID];
  const [assetIdInput, setAssetIdInput] = useState("1");
  const assetId = useMemo(() => toBigInt(assetIdInput), [assetIdInput]);

  const assetCoreRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.rwaAssetRegistry,
    abi: RWA_ASSET_REGISTRY_ABI,
    functionName: "getAssetCore",
    args: assetId !== null ? [assetId] : undefined,
    query: {
      enabled: assetId !== null,
      refetchInterval: 12_000,
    },
  });

  const navFreshRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.navOracle,
    abi: NAV_ORACLE_ABI,
    functionName: "isFresh",
    args: assetId !== null ? [assetId] : undefined,
    query: {
      enabled: assetId !== null,
      refetchInterval: 12_000,
    },
  });

  const navDataRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.navOracle,
    abi: NAV_ORACLE_ABI,
    functionName: "getNAVData",
    args: assetId !== null ? [assetId] : undefined,
    query: {
      enabled: assetId !== null,
      refetchInterval: 12_000,
    },
  });

  const assetCore =
    (assetCoreRead.data as
      | [bigint, number, `0x${string}`, number, bigint, bigint]
      | undefined) ??
    [0n, 0, "0x0000000000000000000000000000000000000000", 0, 0n, 0n];
  const navData =
    (navDataRead.data as [bigint, bigint, `0x${string}`] | undefined) ?? [0n, 0n, "0x0"];
  const isLoading = assetCoreRead.isLoading || navFreshRead.isLoading || navDataRead.isLoading;
  const isError = assetCoreRead.isError || navFreshRead.isError || navDataRead.isError;
  const errorMessage =
    assetCoreRead.error?.message ?? navFreshRead.error?.message ?? navDataRead.error?.message;

  return (
    <section className="rounded-2xl border bg-[color:var(--card)] p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="mono text-xs text-[color:var(--ink-700)]">ASSET OVERVIEW</p>
        <input
          className="w-28 rounded-lg border px-2 py-1 text-sm"
          value={assetIdInput}
          onChange={(e) => setAssetIdInput(e.target.value)}
          placeholder="Asset ID"
        />
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
        </article>
      </div>
    </section>
  );
}
