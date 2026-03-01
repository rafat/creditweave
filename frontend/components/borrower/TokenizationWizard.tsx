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
  const [segmentLabel, setSegmentLabel] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [isTokenizing, setIsTokenizing] = useState(false);

  const generateSegmentId = () => {
    const normalized = segmentLabel.trim().toUpperCase().replace(/\s+/g, "_");
    if (!normalized) {
      onTxStateChange({ phase: "failed", message: "Enter a segment label first (e.g. CORE_MIAMI)." });
      return;
    }
    setSegmentId(keccak256(stringToHex(normalized)));
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
      setSegmentLabel("");
      setSegmentId("");
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1.4fr,1fr,1fr,1fr,1.2fr,auto]">
        <input
          className="rounded-xl border px-4 py-3 text-sm focus:border-black focus:outline-none"
          placeholder="Property Address (e.g., Miami, FL)"
          value={propertyAddress}
          onChange={(e) => setPropertyAddress(e.target.value)}
          disabled={isTokenizing}
        />
        <input
          className="rounded-xl border px-4 py-3 text-sm focus:border-black focus:outline-none"
          placeholder="Market Value ($)"
          type="number"
          value={assetValue}
          onChange={(e) => setAssetValue(e.target.value)}
          disabled={isTokenizing}
        />
        <input
          className="rounded-xl border px-4 py-3 text-sm focus:border-black focus:outline-none"
          placeholder="Monthly Rent ($)"
          type="number"
          value={rentAmount}
          onChange={(e) => setRentAmount(e.target.value)}
          disabled={isTokenizing}
        />
        <select
          className="rounded-xl border px-4 py-3 text-sm focus:border-black focus:outline-none"
          value={loanProduct}
          onChange={(e) => setLoanProduct(e.target.value)}
          disabled={isTokenizing}
        >
          <option value="1">Bridge (V2 Product)</option>
          <option value="2">Stabilized Term</option>
          <option value="3">Construction Lite</option>
        </select>
        <div className="flex gap-2">
          <input
            className="w-full rounded-xl border px-4 py-3 text-sm focus:border-black focus:outline-none"
            placeholder="Segment Label (e.g. CORE_MIAMI)"
            value={segmentLabel}
            onChange={(e) => setSegmentLabel(e.target.value)}
            disabled={isTokenizing}
          />
          <button
            onClick={generateSegmentId}
            type="button"
            disabled={isTokenizing}
            className="rounded-xl border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-700)] transition hover:bg-gray-50 disabled:opacity-50"
          >
            Generate
          </button>
        </div>
        <input
          className="rounded-xl border px-4 py-3 text-sm focus:border-black focus:outline-none"
          placeholder="Segment ID (bytes32, optional)"
          value={segmentId}
          onChange={(e) => setSegmentId(e.target.value)}
          disabled={isTokenizing}
        />
        <button
          onClick={handleTokenize}
          disabled={isTokenizing}
          className="rounded-xl bg-black px-6 py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {isTokenizing ? "Tokenizing..." : "Tokenize & Mint"}
        </button>
      </div>
    </section>
  );
}
