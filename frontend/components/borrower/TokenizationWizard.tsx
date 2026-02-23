"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { TxState } from "@/lib/tx";
import { parseUnits } from "viem";

type Props = {
  onTokenized: (assetId: string) => void;
  onTxStateChange: (tx: TxState) => void;
};

export default function TokenizationWizard({ onTokenized, onTxStateChange }: Props) {
  const { address, isConnected } = useAccount();
  const [propertyAddress, setPropertyAddress] = useState("");
  const [assetValue, setAssetValue] = useState("");
  const [rentAmount, setRentAmount] = useState("");
  const [isTokenizing, setIsTokenizing] = useState(false);

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
    } catch (error: any) {
      onTxStateChange({ phase: "failed", message: error.message });
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

      <div className="grid gap-4 md:grid-cols-[1.5fr,1fr,1fr,auto]">
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
