"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, useReadContract, useWaitForTransactionReceipt } from "wagmi";
import AppNav from "@/components/AppNav";
import BorrowForm from "@/components/borrower/BorrowForm";
import UnderwritingRequestForm from "@/components/borrower/UnderwritingRequestForm";
import UnderwritingStatusCard from "@/components/borrower/UnderwritingStatusCard";
import NetworkGuard from "@/components/NetworkGuard";
import TxStatusInline from "@/components/TxStatusInline";
import TxToast from "@/components/TxToast";
import WalletBar from "@/components/WalletBar";
import { CONTRACTS, UNDERWRITING_REGISTRY_ABI } from "@/lib/contracts";
import { normalizeTxError, type TxState } from "@/lib/tx";
import type { TermsTuple } from "@/lib/underwriting";
import { SUPPORTED_CHAIN_ID } from "@/lib/wagmi";

const toBigInt = (value: string): bigint | null => {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
};

export default function BorrowerDashboard() {
  const { address } = useAccount();
  const currentChainId = useChainId();

  const [assetIdInput, setAssetIdInput] = useState("1");
  const [intendedBorrowInput, setIntendedBorrowInput] = useState("500000");
  const [tx, setTx] = useState<TxState>({ phase: "idle" });

  const assetId = useMemo(() => toBigInt(assetIdInput), [assetIdInput]);
  const contracts = CONTRACTS[SUPPORTED_CHAIN_ID];

  const { isLoading: isConfirming, isSuccess: isConfirmed, error: receiptError } = useWaitForTransactionReceipt({
    hash: tx.hash,
    chainId: SUPPORTED_CHAIN_ID,
  });

  const pendingAmountRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.underwritingRegistry,
    abi: UNDERWRITING_REGISTRY_ABI,
    functionName: "getRequestedBorrowAmount",
    args: address && assetId !== null ? [address, assetId] : undefined,
    query: {
      enabled: Boolean(address && assetId !== null && currentChainId === SUPPORTED_CHAIN_ID),
      refetchInterval: 8_000,
    },
  });

  const termsRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.underwritingRegistry,
    abi: UNDERWRITING_REGISTRY_ABI,
    functionName: "getTerms",
    args: address && assetId !== null ? [address, assetId] : undefined,
    query: {
      enabled: Boolean(address && assetId !== null && currentChainId === SUPPORTED_CHAIN_ID),
      refetchInterval: 8_000,
    },
  });

  useEffect(() => {
    if (tx.phase === "submitted" && isConfirming) {
      setTx((prev) => ({ ...prev, phase: "confirming", message: "Waiting for block confirmation..." }));
    }
  }, [isConfirming, tx.phase]);

  useEffect(() => {
    if (isConfirmed && tx.hash) {
      setTx({
        phase: "confirmed",
        hash: tx.hash,
        message: "Transaction confirmed on Sepolia.",
      });
      pendingAmountRead.refetch();
      termsRead.refetch();
    }
  }, [isConfirmed, tx.hash, pendingAmountRead, termsRead]);

  useEffect(() => {
    if (receiptError) {
      setTx((prev) => ({
        ...prev,
        phase: "failed",
        message: normalizeTxError(receiptError),
      }));
    }
  }, [receiptError]);

  const terms = termsRead.data as TermsTuple | undefined;
  const pendingBorrowAmount = (pendingAmountRead.data as bigint | undefined) ?? 0n;
  const statusLoading = pendingAmountRead.isLoading || termsRead.isLoading;
  const statusError = pendingAmountRead.isError || termsRead.isError;
  const statusErrorMessage = pendingAmountRead.error?.message ?? termsRead.error?.message;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
      <AppNav />
      <WalletBar />
      <TxToast tx={tx} />

      <section className="rounded-3xl border bg-[color:var(--card)] p-6 shadow-[0_20px_60px_rgba(18,33,38,0.08)]">
        <p className="mono text-xs tracking-[0.24em] text-[color:var(--ink-700)]">
          CREDITWEAVE • BORROWER FLOW
        </p>
        <h1 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">
          Request underwriting privately, receive enforceable onchain terms.
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-[color:var(--ink-700)] md:text-base">
          Borrower financial data remains offchain. Only approval terms and reasoning hash are posted onchain.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <UnderwritingStatusCard
          assetIdInput={assetIdInput}
          pendingBorrowAmount={pendingBorrowAmount}
          terms={terms}
          registryAddress={contracts.underwritingRegistry}
          isLoading={statusLoading}
          isError={statusError}
          errorMessage={statusErrorMessage}
        />
        <article className="rounded-2xl border bg-[color:var(--card)] p-5">
          <p className="mono text-xs text-[color:var(--ink-700)]">CONFIDENTIALITY GUARANTEE</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <span className="rounded-lg bg-[color:var(--mint-100)] px-3 py-2">Income data: offchain</span>
            <span className="rounded-lg bg-[color:var(--mint-100)] px-3 py-2">Credit data: offchain</span>
            <span className="rounded-lg bg-[color:var(--mint-100)] px-3 py-2">KYC/AML: offchain</span>
            <span className="rounded-lg bg-[color:var(--mint-100)] px-3 py-2">AI reasoning: hashed</span>
          </div>
        </article>
      </section>

      <NetworkGuard>
        <>
          <UnderwritingRequestForm
            assetIdInput={assetIdInput}
            setAssetIdInput={setAssetIdInput}
            intendedBorrowInput={intendedBorrowInput}
            setIntendedBorrowInput={setIntendedBorrowInput}
            onRefreshReads={() => {
              pendingAmountRead.refetch();
              termsRead.refetch();
            }}
            onTxStateChange={setTx}
          />

          <BorrowForm
            assetIdInput={assetIdInput}
            terms={terms}
            onTxStateChange={setTx}
          />
        </>
      </NetworkGuard>

      <TxStatusInline tx={tx} chainId={SUPPORTED_CHAIN_ID} />
    </main>
  );
}
