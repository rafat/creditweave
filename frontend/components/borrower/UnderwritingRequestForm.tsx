"use client";

import { parseUnits } from "viem";
import { useAccount, useChainId, useWriteContract } from "wagmi";
import { CONTRACTS, UNDERWRITING_REGISTRY_ABI } from "@/lib/contracts";
import { normalizeTxError, type TxState } from "@/lib/tx";
import { SUPPORTED_CHAIN_ID } from "@/lib/wagmi";

type Props = {
  assetIdInput: string;
  setAssetIdInput: (value: string) => void;
  intendedBorrowInput: string;
  setIntendedBorrowInput: (value: string) => void;
  onRefreshReads: () => void;
  onTxStateChange: (tx: TxState) => void;
};

const toBigInt = (value: string): bigint | null => {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
};

export default function UnderwritingRequestForm({
  assetIdInput,
  setAssetIdInput,
  intendedBorrowInput,
  setIntendedBorrowInput,
  onRefreshReads,
  onTxStateChange,
}: Props) {
  const { address, isConnected } = useAccount();
  const currentChainId = useChainId();
  const { writeContractAsync } = useWriteContract();
  const contracts = CONTRACTS[SUPPORTED_CHAIN_ID];

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

      const intendedBorrowAmount = parseUnits(intendedBorrowInput, 18);
      if (intendedBorrowAmount <= 0n) {
        throw new Error("Intended borrow amount must be greater than zero.");
      }

      onTxStateChange({
        phase: "awaiting_signature",
        message: "Confirm transaction in MetaMask...",
      });

      const hash = await writeContractAsync({
        chainId: SUPPORTED_CHAIN_ID,
        address: contracts.underwritingRegistry,
        abi: UNDERWRITING_REGISTRY_ABI,
        functionName: "requestUnderwriting",
        args: [assetId, intendedBorrowAmount],
      });

      onTxStateChange({
        phase: "submitted",
        hash,
        message: "Transaction submitted. Waiting for confirmation...",
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
      <p className="mono text-xs text-[color:var(--ink-700)]">BORROWER REQUEST</p>
      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <input
          className="rounded-xl border px-3 py-2 text-sm"
          value={assetIdInput}
          onChange={(e) => setAssetIdInput(e.target.value)}
          placeholder="Asset ID"
        />
        <input
          className="rounded-xl border px-3 py-2 text-sm"
          value={intendedBorrowInput}
          onChange={(e) => setIntendedBorrowInput(e.target.value)}
          placeholder="Intended Borrow Amount"
        />
        <button
          type="button"
          onClick={onRefreshReads}
          className="rounded-xl border bg-white px-4 py-2 text-sm font-medium transition hover:bg-[color:var(--mint-100)]"
        >
          Refresh Reads
        </button>
        <button
          type="button"
          onClick={submitUnderwritingRequest}
          className="rounded-xl bg-[color:var(--ink-900)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          Request Underwriting
        </button>
      </div>

      <p className="mt-3 text-xs text-[color:var(--ink-700)]">
        Amount is interpreted as 18-decimal token units.
      </p>
    </section>
  );
}
