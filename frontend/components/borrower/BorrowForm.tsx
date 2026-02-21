"use client";

import { useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useChainId, useReadContract, useWriteContract } from "wagmi";
import {
  CONTRACTS,
  LENDING_POOL_ABI,
  NAV_ORACLE_ABI,
} from "@/lib/contracts";
import { normalizeTxError, type TxState } from "@/lib/tx";
import type { TermsTuple } from "@/lib/underwriting";
import { SUPPORTED_CHAIN_ID } from "@/lib/wagmi";

type Props = {
  assetIdInput: string;
  terms?: TermsTuple;
  onTxStateChange: (tx: TxState) => void;
};

const toBigInt = (value: string): bigint | null => {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
};

export default function BorrowForm({ assetIdInput, terms, onTxStateChange }: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { writeContractAsync } = useWriteContract();

  const [borrowAmountInput, setBorrowAmountInput] = useState("1000");
  const contracts = CONTRACTS[SUPPORTED_CHAIN_ID];
  const assetId = useMemo(() => toBigInt(assetIdInput), [assetIdInput]);

  const approved = terms?.[0] ?? false;
  const maxLtvBps = terms?.[1] ?? 0;
  const expiry = terms?.[3] ?? 0n;
  const isExpired = expiry > 0n && expiry <= BigInt(Math.floor(Date.now() / 1000));

  const collateralRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.lendingPool,
    abi: LENDING_POOL_ABI,
    functionName: "collateral",
    args: address && assetId !== null ? [address, assetId] : undefined,
    query: {
      enabled: Boolean(address && assetId !== null && chainId === SUPPORTED_CHAIN_ID),
      refetchInterval: 8_000,
    },
  });

  const debtRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.lendingPool,
    abi: LENDING_POOL_ABI,
    functionName: "debt",
    args: address && assetId !== null ? [address, assetId] : undefined,
    query: {
      enabled: Boolean(address && assetId !== null && chainId === SUPPORTED_CHAIN_ID),
      refetchInterval: 8_000,
    },
  });

  const navFreshRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.navOracle,
    abi: NAV_ORACLE_ABI,
    functionName: "isFresh",
    args: assetId !== null ? [assetId] : undefined,
    query: {
      enabled: Boolean(assetId !== null && chainId === SUPPORTED_CHAIN_ID),
      refetchInterval: 8_000,
    },
  });

  const navDataRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.navOracle,
    abi: NAV_ORACLE_ABI,
    functionName: "getNAVData",
    args: assetId !== null ? [assetId] : undefined,
    query: {
      enabled: Boolean(assetId !== null && chainId === SUPPORTED_CHAIN_ID),
      refetchInterval: 8_000,
    },
  });

  const collateralShares = (collateralRead.data as bigint | undefined) ?? 0n;
  const debtPrincipal = ((debtRead.data as [bigint, bigint] | undefined)?.[0] ?? 0n);
  const navIsFresh = Boolean(navFreshRead.data);
  const nav = ((navDataRead.data as [bigint, bigint, `0x${string}`] | undefined)?.[0] ?? 0n);

  const collateralValue = (collateralShares * nav) / 10n ** 18n;
  const maxBorrowFromTerms = (collateralValue * BigInt(maxLtvBps)) / 10_000n;
  const remainingBorrowCapacity =
    maxBorrowFromTerms > debtPrincipal ? maxBorrowFromTerms - debtPrincipal : 0n;

  const canBorrow =
    Boolean(assetId !== null) &&
    approved &&
    !isExpired &&
    navIsFresh &&
    nav > 0n &&
    remainingBorrowCapacity > 0n;

  const submitBorrow = async () => {
    try {
      if (!isConnected || !address) throw new Error("Connect wallet first.");
      if (chainId !== SUPPORTED_CHAIN_ID) throw new Error("Switch to Sepolia first.");
      if (assetId === null) throw new Error("Asset ID must be a valid integer.");
      if (!approved) throw new Error("Borrow disabled: underwriting not approved.");
      if (isExpired) throw new Error("Borrow disabled: underwriting terms expired.");
      if (!navIsFresh || nav === 0n) throw new Error("Borrow disabled: NAV is stale or unavailable.");

      const borrowAmount = parseUnits(borrowAmountInput, 18);
      if (borrowAmount <= 0n) throw new Error("Borrow amount must be greater than zero.");
      if (borrowAmount > remainingBorrowCapacity) {
        throw new Error("Borrow amount exceeds estimated remaining borrow capacity.");
      }

      onTxStateChange({
        phase: "awaiting_signature",
        message: "Confirm borrow transaction in MetaMask...",
      });

      const hash = await writeContractAsync({
        chainId: SUPPORTED_CHAIN_ID,
        address: contracts.lendingPool,
        abi: LENDING_POOL_ABI,
        functionName: "borrow",
        args: [assetId, borrowAmount],
      });

      onTxStateChange({
        phase: "submitted",
        hash,
        message: "Borrow transaction submitted. Waiting for confirmation...",
      });
    } catch (error) {
      onTxStateChange({
        phase: "failed",
        message: normalizeTxError(error),
      });
    }
  };

  return (
    <section className="rounded-2xl border bg-[color:var(--card)] p-5">
      <p className="mono text-xs text-[color:var(--ink-700)]">BORROW ACTION</p>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <input
          className="rounded-xl border px-3 py-2 text-sm"
          value={borrowAmountInput}
          onChange={(e) => setBorrowAmountInput(e.target.value)}
          placeholder="Borrow Amount"
        />
        <button
          type="button"
          onClick={submitBorrow}
          disabled={!canBorrow}
          className="rounded-xl bg-[color:var(--ink-900)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Borrow
        </button>
      </div>

      <div className="mt-4 space-y-2 text-sm">
        <p className="flex justify-between">
          <span>Term approval</span>
          <span className="mono">{approved ? "approved" : "not approved"}</span>
        </p>
        <p className="flex justify-between">
          <span>Term expiry</span>
          <span className="mono">{isExpired ? "expired" : "active"}</span>
        </p>
        <p className="flex justify-between">
          <span>NAV freshness</span>
          <span className="mono">{navIsFresh ? "fresh" : "stale"}</span>
        </p>
        <p className="flex justify-between">
          <span>Estimated max borrow (terms)</span>
          <span className="mono">{formatUnits(maxBorrowFromTerms, 18)} tokens</span>
        </p>
        <p className="flex justify-between">
          <span>Current principal debt</span>
          <span className="mono">{formatUnits(debtPrincipal, 18)} tokens</span>
        </p>
        <p className="flex justify-between">
          <span>Estimated remaining capacity</span>
          <span className="mono">{formatUnits(remainingBorrowCapacity, 18)} tokens</span>
        </p>
      </div>
    </section>
  );
}
