"use client";

import { formatUnits, zeroAddress } from "viem";
import { useReadContract } from "wagmi";
import { CONTRACTS, ERC20_ABI, LENDING_POOL_ABI } from "@/lib/contracts";
import { SUPPORTED_CHAIN_ID } from "@/lib/wagmi";

export default function PoolOverview() {
  const contracts = CONTRACTS[SUPPORTED_CHAIN_ID];

  const stablecoinRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.lendingPool,
    abi: LENDING_POOL_ABI,
    functionName: "stablecoin",
  });

  const stablecoinAddress =
    (stablecoinRead.data as `0x${string}` | undefined) ?? zeroAddress;

  const liquidityRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: stablecoinAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [contracts.lendingPool],
    query: {
      enabled: stablecoinAddress !== zeroAddress,
      refetchInterval: 12_000,
    },
  });

  const poolLiquidity = (liquidityRead.data as bigint | undefined) ?? 0n;
  const poolLiquidityDisplay = formatUnits(poolLiquidity, 18);
  const isLoading = stablecoinRead.isLoading || liquidityRead.isLoading;
  const isError = stablecoinRead.isError || liquidityRead.isError;
  const errorMessage = stablecoinRead.error?.message ?? liquidityRead.error?.message;

  return (
    <section className="rounded-2xl border bg-[color:var(--card)] p-5">
      <p className="mono text-xs text-[color:var(--ink-700)]">POOL OVERVIEW</p>
      {isLoading ? (
        <p className="mt-3 text-sm text-[color:var(--ink-700)]">Loading pool metrics...</p>
      ) : null}
      {isError ? (
        <p className="mt-3 rounded-lg bg-[#fdecea] px-3 py-2 text-xs text-[#8c2d25]">
          {errorMessage ?? "Failed to load pool metrics."}
        </p>
      ) : null}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <article className="rounded-xl border p-4">
          <p className="mono text-xs text-[color:var(--ink-700)]">POOL LIQUIDITY</p>
          <p className="mt-2 text-2xl font-semibold">{poolLiquidityDisplay}</p>
          <p className="mt-1 text-xs text-[color:var(--ink-700)]">Stable token units</p>
        </article>
        <article className="rounded-xl border p-4">
          <p className="mono text-xs text-[color:var(--ink-700)]">STABLE TOKEN</p>
          <p className="mono mt-2 text-xs">{stablecoinAddress}</p>
          <p className="mt-1 text-xs text-[color:var(--ink-700)]">
            Read from `RWALendingPool.stablecoin()`
          </p>
        </article>
      </div>
    </section>
  );
}
