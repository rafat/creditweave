"use client";

import { formatUnits } from "viem";
import {
  deriveUnderwritingState,
  getRiskBadge,
  getStatusLabel,
  type TermsTuple,
} from "@/lib/underwriting";

type Props = {
  assetIdInput: string;
  pendingBorrowAmount: bigint;
  terms?: TermsTuple;
  registryAddress: string;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
};

export default function UnderwritingStatusCard({
  assetIdInput,
  pendingBorrowAmount,
  terms,
  registryAddress,
  isLoading = false,
  isError = false,
  errorMessage,
}: Props) {
  if (isLoading) {
    return (
      <section className="rounded-2xl border bg-[color:var(--card)] p-5">
        <p className="mono text-xs text-[color:var(--ink-700)]">UNDERWRITING STATUS</p>
        <p className="mt-3 text-sm text-[color:var(--ink-700)]">Loading underwriting terms...</p>
      </section>
    );
  }

  if (isError) {
    return (
      <section className="rounded-2xl border bg-[color:var(--card)] p-5">
        <p className="mono text-xs text-[color:var(--ink-700)]">UNDERWRITING STATUS</p>
        <p className="mt-3 rounded-lg bg-[#fdecea] px-3 py-2 text-xs text-[#8c2d25]">
          {errorMessage ?? "Failed to load underwriting status."}
        </p>
      </section>
    );
  }

  const approved = terms?.[0] ?? false;
  const maxLtvBps = terms?.[1] ?? 0;
  const rateBps = terms?.[2] ?? 0;
  const expiry = terms?.[3] ?? 0n;
  const reasoningHash = terms?.[4];

  const state = deriveUnderwritingState(pendingBorrowAmount, terms);
  const statusLabel = getStatusLabel(state);
  const riskBadge = getRiskBadge(approved, maxLtvBps);

  const expiryDate =
    expiry > 0n ? new Date(Number(expiry) * 1000).toISOString().slice(0, 10) : "N/A";

  const shortHash =
    reasoningHash && !/^0x0+$/.test(reasoningHash)
      ? `${reasoningHash.slice(0, 8)}...${reasoningHash.slice(-6)}`
      : "N/A";

  return (
    <section className="rounded-2xl border bg-[color:var(--card)] p-5">
      <p className="mono text-xs text-[color:var(--ink-700)]">UNDERWRITING STATUS</p>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border p-4">
          <p className="mono text-xs text-[color:var(--ink-700)]">STATUS</p>
          <p className="mt-2 text-2xl font-semibold text-[color:var(--mint-500)]">
            {statusLabel}
          </p>
          <p className="mt-1 text-sm text-[color:var(--ink-700)]">Risk Badge: {riskBadge}</p>
        </div>
        <div className="rounded-xl border p-4">
          <p className="mono text-xs text-[color:var(--ink-700)]">MAX LTV</p>
          <p className="mt-2 text-2xl font-semibold">{(maxLtvBps / 100).toFixed(2)}%</p>
          <p className="mt-1 text-sm text-[color:var(--ink-700)]">{maxLtvBps} bps</p>
        </div>
        <div className="rounded-xl border p-4">
          <p className="mono text-xs text-[color:var(--ink-700)]">RATE</p>
          <p className="mt-2 text-2xl font-semibold">{(rateBps / 100).toFixed(2)}%</p>
          <p className="mt-1 text-sm text-[color:var(--ink-700)]">{rateBps} bps</p>
        </div>
      </div>

      <div className="mt-4 space-y-2 text-sm">
        <p className="flex justify-between">
          <span>Pending Requested Borrow</span>
          <span className="mono">
            {formatUnits(pendingBorrowAmount, 18)} tokens ({pendingBorrowAmount.toString()} wei)
          </span>
        </p>
        <p className="flex justify-between">
          <span>Expiry</span>
          <span className="mono">{expiryDate}</span>
        </p>
        <p className="flex justify-between">
          <span>Reasoning Hash</span>
          <span className="mono">{shortHash}</span>
        </p>
        <p className="flex justify-between">
          <span>Asset ID</span>
          <span className="mono">#{assetIdInput}</span>
        </p>
        <p className="flex justify-between">
          <span>Registry</span>
          <span className="mono">{registryAddress}</span>
        </p>
      </div>
    </section>
  );
}
