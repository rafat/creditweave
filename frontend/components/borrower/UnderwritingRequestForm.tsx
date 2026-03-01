"use client";

import { useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useChainId, useWriteContract } from "wagmi";
import {
  CONTRACTS,
  UNDERWRITING_REGISTRY_ABI,
  UNDERWRITING_REGISTRY_V2_ABI,
} from "@/lib/contracts";
import { normalizeTxError, type TxState } from "@/lib/tx";
import type { TermsTuple } from "@/lib/underwriting";
import { SUPPORTED_CHAIN_ID } from "@/lib/wagmi";

type Props = {
  assetIdInput: string;
  setAssetIdInput: (value: string) => void;
  intendedBorrowInput: string;
  setIntendedBorrowInput: (value: string) => void;
  terms?: TermsTuple;
  onRefreshReads: () => void;
  onTxStateChange: (tx: TxState) => void;
  onUnderwritingRequestSubmitted?: (hash: `0x${string}`) => void;
};

const toBigInt = (value: string): bigint | null => {
  try {
    const clean = value.replace(/,/g, "").replace(/\$/g, "");
    return BigInt(clean);
  } catch {
    return null;
  }
};

const ONE_E18 = 10n ** 18n;
const PROTOCOL_MAX_REQUEST_USD = 100_000n;

export default function UnderwritingRequestForm({
  assetIdInput,
  setAssetIdInput,
  intendedBorrowInput,
  setIntendedBorrowInput,
  terms,
  onRefreshReads,
  onTxStateChange,
  onUnderwritingRequestSubmitted,
}: Props) {
  const { address, isConnected } = useAccount();
  const currentChainId = useChainId();
  const { writeContractAsync } = useWriteContract();
  const contracts = CONTRACTS[SUPPORTED_CHAIN_ID];
  const underwritingAddress = contracts.activeUnderwritingRegistry;

  const [loanPurpose, setLoanPurpose] = useState("Expansion");

  // Handle formatted currency input
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9]/g, "");
    if (val === "") {
      setIntendedBorrowInput("");
      return;
    }
    const formatted = Number(val).toLocaleString();
    setIntendedBorrowInput(formatted);
  };

  const rawAmount = intendedBorrowInput.replace(/,/g, "");
  const approvedCreditLimit = terms?.[3] ?? 0n;
  const protocolHardCapWei = PROTOCOL_MAX_REQUEST_USD * ONE_E18;
  const underwritingHardCapWei =
    approvedCreditLimit > 0n && approvedCreditLimit < protocolHardCapWei
      ? approvedCreditLimit
      : protocolHardCapWei;
  const approvedCreditLimitDisplay = Number(formatUnits(underwritingHardCapWei, 18)).toLocaleString();

  const submitUnderwritingRequest = async () => {
    try {
      if (!isConnected || !address) {
        throw new Error("Connect wallet first.");
      }
      if (currentChainId !== SUPPORTED_CHAIN_ID) {
        throw new Error("Switch to Sepolia first.");
      }

      const assetId = toBigInt(assetIdInput);
      if (assetId === null) {
        throw new Error("Asset ID must be a valid integer.");
      }

      const intendedBorrowAmount = parseUnits(rawAmount, 18);
      if (intendedBorrowAmount <= 0n) {
        throw new Error("Intended borrow amount must be greater than zero.");
      }
      if (intendedBorrowAmount > underwritingHardCapWei) {
        throw new Error(
          `Requested limit exceeds underwriting hard cap ($${approvedCreditLimitDisplay}).`,
        );
      }

      onTxStateChange({
        phase: "awaiting_signature",
        message: "Confirming credit application...",
      });

      const hash = await writeContractAsync({
        chainId: SUPPORTED_CHAIN_ID,
        address: underwritingAddress,
        abi: contracts.usesUnderwritingV2 ? UNDERWRITING_REGISTRY_V2_ABI : UNDERWRITING_REGISTRY_ABI,
        functionName: "requestUnderwriting",
        args: [assetId, intendedBorrowAmount],
      });

      onTxStateChange({
        phase: "submitted",
        hash,
        message: "Application submitted to CRE. Processing...",
      });
      onUnderwritingRequestSubmitted?.(hash);
    } catch (error) {
      onTxStateChange({
        phase: "failed",
        message: normalizeTxError(error),
      });
    }
  };

  return (
    <section className="rounded-3xl border bg-white p-6 shadow-sm">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <p className="mono text-[10px] font-bold tracking-[0.2em] text-blue-600 uppercase">Step 1: Credit Underwriting</p>
          <h2 className="mt-1 text-2xl font-semibold text-gray-900">Institutional Loan Application</h2>
          <p className="text-sm text-gray-500">Submit your intent for confidential AI-driven risk assessment.</p>
        </div>
        <div className="flex gap-2">
           <div className="flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 border border-green-100">
             <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
             <span className="text-[10px] font-bold text-green-700 uppercase tracking-tight">CRE Environment Active</span>
           </div>
        </div>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-3">
        {/* Asset Selection */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">Asset Reference</label>
          <div className="relative">
            <input
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
              value={assetIdInput}
              onChange={(e) => setAssetIdInput(e.target.value)}
              placeholder="e.g. 1"
            />
            <span className="absolute right-4 top-3.5 text-xs text-gray-400 font-mono">ID</span>
          </div>
        </div>

        {/* Loan Purpose */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">Loan Purpose</label>
          <select 
            value={loanPurpose}
            onChange={(e) => setLoanPurpose(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none transition-all appearance-none"
          >
            <option>Business Expansion</option>
            <option>Working Capital</option>
            <option>Debt Refinance</option>
            <option>Asset Improvement</option>
          </select>
        </div>

        {/* Amount Input */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">Requested Limit</label>
          <div className="relative">
            <span className="absolute left-4 top-3.5 text-sm text-gray-400">$</span>
            <input
              className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-8 pr-4 py-3 text-sm font-semibold focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
              value={intendedBorrowInput}
              onChange={handleAmountChange}
              placeholder="100,000"
            />
          </div>
          <p className="text-[11px] text-gray-500">
            Current approved hard cap: <span className="font-semibold text-gray-700">${approvedCreditLimitDisplay}</span>
          </p>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-6 border-t pt-6">
        <div className="flex items-center gap-6">
          <div className="flex flex-col gap-1">
             <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.1em]">Identity</span>
             <div className="flex items-center gap-1">
               <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
               <span className="text-[11px] font-medium text-gray-600">KYC/AML Linked</span>
             </div>
          </div>
          <div className="flex flex-col gap-1">
             <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.1em]">Financials</span>
             <div className="flex items-center gap-1">
               <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
               <span className="text-[11px] font-medium text-gray-600">Plaid Connected</span>
             </div>
          </div>
          <div className="flex flex-col gap-1">
             <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.1em]">Credit</span>
             <div className="flex items-center gap-1">
               <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
               <span className="text-[11px] font-medium text-gray-600">Experian Ready</span>
             </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onRefreshReads}
            className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-xs font-bold text-gray-600 transition hover:bg-gray-50 active:scale-95"
          >
            REFRESH DATA
          </button>
          <button
            type="button"
            onClick={submitUnderwritingRequest}
            className="rounded-xl bg-blue-600 px-8 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-100 transition hover:bg-blue-700 hover:shadow-blue-200 active:scale-95"
          >
            SUBMIT APPLICATION
          </button>
        </div>
      </div>
      
      <div className="mt-4 rounded-xl bg-blue-50/50 p-4 border border-blue-100/50">
        <div className="flex gap-3">
          <div className="text-blue-600 mt-0.5">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-[11px] text-blue-800 leading-relaxed">
            <strong>Confidentiality Notice:</strong> Your sensitive financial data is processed within a secure Chainlink Confidential Runtime Environment (CRE). Only the final risk parameters and a cryptographic reasoning hash are committed to the blockchain.
          </p>
        </div>
      </div>
    </section>
  );
}
