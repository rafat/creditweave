"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { TxState } from "@/lib/tx";
import { keccak256, parseUnits, stringToHex } from "viem";

type Props = {
  onTokenized: (assetId: string) => void;
  onTxStateChange: (tx: TxState) => void;
};

export default function TokenizationWizard({ onTokenized, onTxStateChange }: Props) {
  const { address, isConnected } = useAccount();
  const [propertyAddress, setPropertyAddress] = useState("");
  const [assetValue, setAssetValue] = useState("");
  const [rentAmount, setRentAmount] = useState("");
  const [loanProduct, setLoanProduct] = useState("1");
  const [segmentLabel, setSegmentLabel] = useState("CORE_US_PRIMARY");
  const [segmentId, setSegmentId] = useState<`0x${string}`>(() =>
    keccak256(stringToHex("CORE_US_PRIMARY"))
  );
  const [isTokenizing, setIsTokenizing] = useState(false);

  const SEGMENT_OPTIONS = [
    "CORE_US_PRIMARY",
    "BRIDGE_SUNBELT",
    "STABILIZED_GATEWAY",
    "CONSTRUCTION_GROWTH",
  ] as const;

  const applySegmentSelection = (label: string) => {
    setSegmentLabel(label);
    setSegmentId(keccak256(stringToHex(label)));
  };

  const handleTokenize = async () => {
    if (!isConnected || !address) {
      onTxStateChange({ phase: "failed", message: "Connect wallet first." });
      return;
    }

    if (!propertyAddress || !assetValue || !rentAmount) {
      onTxStateChange({ phase: "failed", message: "Fill in all fields." });
      return;
    }

    try {
      setIsTokenizing(true);
      onTxStateChange({
        phase: "submitted",
        hash: "0x...", // Fake hash since it's backend-driven
        message: "Platform is tokenizing asset, deploying logic, and minting shares. This takes ~30 seconds...",
      });

      const valueWei = parseUnits(assetValue, 18).toString(); 
      const rentWei = parseUnits(rentAmount, 18).toString();

      const response = await fetch("/api/rpc/tokenize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyAddress,
          assetValue: valueWei,
          rentAmount: rentWei,
          borrowerAddress: address,
          loanProduct: Number(loanProduct),
          segmentId: segmentId || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Tokenization failed on backend.");
      }

      onTxStateChange({
        phase: "confirmed",
        hash: "0x...", 
        message: `Asset Tokenized Successfully! Asset ID: ${data.assetId}`,
      });

      onTokenized(data.assetId.toString());
      setPropertyAddress("");
      setAssetValue("");
      setRentAmount("");
      setLoanProduct("1");
      applySegmentSelection("CORE_US_PRIMARY");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Tokenization failed";
      onTxStateChange({ phase: "failed", message });
    } finally {
      setIsTokenizing(false);
    }
  };

  return (
    <section className="rounded-2xl border bg-[#fcfcfc] p-6 shadow-sm mb-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--mint-100)] text-[color:var(--mint-700)]">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[color:var(--ink-900)]">Step 1: Tokenize Property</h2>
          <p className="text-sm text-[color:var(--ink-700)]">
            Register a real-world property to receive ERC20 collateral shares.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-700)]">Property Address</label>
          <input
            className="rounded-xl border px-4 py-3 text-sm focus:border-black focus:outline-none"
            placeholder="e.g., 1503 NW 17th Ter, Gainesville FL"
            value={propertyAddress}
            onChange={(e) => setPropertyAddress(e.target.value)}
            disabled={isTokenizing}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-700)]">Market Value (USD)</label>
          <input
            className="rounded-xl border px-4 py-3 text-sm focus:border-black focus:outline-none"
            placeholder="e.g., 550000"
            type="number"
            value={assetValue}
            onChange={(e) => setAssetValue(e.target.value)}
            disabled={isTokenizing}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-700)]">Monthly Rent (USD)</label>
          <input
            className="rounded-xl border px-4 py-3 text-sm focus:border-black focus:outline-none"
            placeholder="e.g., 3000"
            type="number"
            value={rentAmount}
            onChange={(e) => setRentAmount(e.target.value)}
            disabled={isTokenizing}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-700)]">Loan Product (V2)</label>
          <select
            className="rounded-xl border px-4 py-3 text-sm focus:border-black focus:outline-none"
            value={loanProduct}
            onChange={(e) => setLoanProduct(e.target.value)}
            disabled={isTokenizing}
          >
            <option value="1">Bridge</option>
            <option value="2">Stabilized Term</option>
            <option value="3">Construction Lite</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-700)]">Portfolio Segment</label>
          <select
            className="rounded-xl border px-4 py-3 text-sm focus:border-black focus:outline-none"
            value={segmentLabel}
            onChange={(e) => applySegmentSelection(e.target.value)}
            disabled={isTokenizing}
          >
            {SEGMENT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-700)]">Segment ID (Auto)</label>
          <input
            className="rounded-xl border px-4 py-3 text-sm focus:border-black focus:outline-none"
            value={segmentId}
            readOnly
            disabled={isTokenizing}
          />
        </div>
        <button
          onClick={handleTokenize}
          disabled={isTokenizing}
          className="rounded-xl bg-black px-6 py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50 xl:col-span-3"
        >
          {isTokenizing ? "Tokenizing..." : "Tokenize & Mint"}
        </button>
      </div>
    </section>
  );
}
