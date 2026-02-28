"use client";

import { useEffect, useState } from "react";
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
  nav?: bigint;
  registryAddress: string;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
};

interface AIExplanation {
  summary: string;
  keyRisks: string[];
  confidenceLevel: "LOW" | "MEDIUM" | "HIGH";
  riskFlags: string[];
}

export default function UnderwritingStatusCard({
  assetIdInput,
  pendingBorrowAmount,
  terms,
  nav = 0n,
  registryAddress,
  isLoading = false,
  isError = false,
  errorMessage,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [explanation, setExplanation] = useState<AIExplanation | null>(null);

  const reasoningHash = terms?.[5];

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!reasoningHash || /^0x0+$/.test(reasoningHash)) {
      setExplanation(null);
      return;
    }
    const fetchExplanation = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_PRIVATE_API_URL || "http://localhost:3001";
        const res = await fetch(`${apiUrl}/frontend/explanations/${reasoningHash}`);
        if (res.ok) {
          const data = await res.json();
          setExplanation(data.explanation || data);
        } else {
          setExplanation(null);
        }
      } catch {
        setExplanation(null);
      }
    };
    fetchExplanation();
  }, [reasoningHash]);

  if (!mounted) return null;

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
  const creditLimit = terms?.[3] ?? 0n;
  const expiry = terms?.[4] ?? 0n;

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
      <div className="mt-3 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border p-3 sm:p-4">
          <p className="mono text-xs text-[color:var(--ink-700)]">STATUS</p>
          <p className="mt-2 text-xl font-semibold text-[color:var(--mint-500)] truncate">
            {statusLabel}
          </p>
          <p className="mt-1 text-sm text-[color:var(--ink-700)]">Risk Badge: {riskBadge}</p>
        </div>
        <div className="rounded-xl border p-3 sm:p-4">
          <p className="mono text-xs text-[color:var(--ink-700)]">CREDIT LIMIT</p>
          <p className="mt-2 text-xl font-semibold truncate">
            ${Number(formatUnits(creditLimit, 18)).toLocaleString()}
          </p>
          <p className="mt-1 text-sm text-[color:var(--ink-700)]">Approved Amount</p>
        </div>
        <div className="rounded-xl border p-3 sm:p-4">
          <p className="mono text-xs text-[color:var(--ink-700)]">MAX LTV</p>
          <p className="mt-2 text-xl font-semibold">{(maxLtvBps / 100).toFixed(2)}%</p>
          <p className="mt-1 text-sm text-[color:var(--ink-700)]">{maxLtvBps} bps</p>
        </div>
        <div className="rounded-xl border p-3 sm:p-4">
          <p className="mono text-xs text-[color:var(--ink-700)]">RATE</p>
          <p className="mt-2 text-xl font-semibold">{(rateBps / 100).toFixed(2)}%</p>
          <p className="mt-1 text-sm text-[color:var(--ink-700)]">{rateBps} bps</p>
        </div>
        <div className="rounded-xl border p-3 sm:p-4">
          <p className="mono text-xs text-[color:var(--ink-700)]">NET ASSET VALUE (NAV)</p>
          <p className="mt-2 text-xl font-semibold truncate">
            ${Number(formatUnits(nav, 18)).toLocaleString()}
          </p>
          <p className="mt-1 text-sm text-[color:var(--ink-700)]">Verified Value</p>
        </div>
      </div>

      <div className="mt-4 space-y-2 text-sm">
        <p className="flex justify-between">
          <span>Pending Requested Borrow</span>
          <span className="mono font-medium">
            ${Number(formatUnits(pendingBorrowAmount, 18)).toLocaleString()}
          </span>
        </p>
        <p className="flex justify-between">
          <span>Expiry</span>
          <span className="mono">{expiryDate}</span>
        </p>
        <div className="flex flex-col gap-2 border-t pt-4">
          <div className="flex justify-between">
            <span>Reasoning Hash</span>
            <span className="mono">{shortHash}</span>
          </div>
          {explanation && (
            <div className="mt-3 flex flex-col gap-3 rounded-2xl bg-gradient-to-br from-[#f8f9fa] to-[#f1f3f5] p-5 border shadow-sm">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-gray-900">AI Underwriting Analysis</h3>
                {explanation.confidenceLevel && (
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider text-white ${
                    explanation.confidenceLevel === "HIGH" ? "bg-green-500" :
                    explanation.confidenceLevel === "MEDIUM" ? "bg-yellow-500" : "bg-red-500"
                  }`}>
                    {explanation.confidenceLevel} CONFIDENCE
                  </span>
                )}
              </div>
              
              {explanation.summary && (
                <p className="text-sm text-gray-700 leading-relaxed border-l-2 border-blue-200 pl-3">
                  {explanation.summary}
                </p>
              )}

              {explanation.keyRisks?.length > 0 && (
                <div className="mt-1">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Key Risk Factors</h4>
                  <ul className="flex flex-col gap-1.5">
                    {explanation.keyRisks.map((risk: string, i: number) => (
                      <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                        <span className="text-red-400 mt-0.5">•</span>
                        <span>{risk}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
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
