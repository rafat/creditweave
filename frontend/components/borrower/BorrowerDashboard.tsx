"use client";

import { useEffect, useMemo, useState } from "react";
import { keccak256, parseAbiItem, toHex } from "viem";
import { useAccount, useChainId, usePublicClient, useReadContract, useWaitForTransactionReceipt } from "wagmi";
import AppNav from "@/components/AppNav";
import BorrowForm from "@/components/borrower/BorrowForm";
import CreSimulationCard from "@/components/borrower/CreSimulationCard";
import UnderwritingRequestForm from "@/components/borrower/UnderwritingRequestForm";
import UnderwritingStatusCard from "@/components/borrower/UnderwritingStatusCard";
import NetworkGuard from "@/components/NetworkGuard";
import TxStatusInline from "@/components/TxStatusInline";
import TxToast from "@/components/TxToast";
import WalletBar from "@/components/WalletBar";
import { CONTRACTS, NAV_ORACLE_ABI, UNDERWRITING_REGISTRY_ABI } from "@/lib/contracts";
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

const UNDERWRITING_REQUESTED_EVENT = parseAbiItem(
  "event UnderwritingRequested(address indexed borrower, uint256 indexed assetId, uint256 intendedBorrowAmount, uint64 nonce)",
);

import AssetSelector from "./AssetSelector";

export default function BorrowerDashboard() {
  const { address } = useAccount();
  const currentChainId = useChainId();
  const publicClient = usePublicClient({ chainId: SUPPORTED_CHAIN_ID });

  const [assetIdInput, setAssetIdInput] = useState("");
  const [intendedBorrowInput, setIntendedBorrowInput] = useState("100,000");
  const [tx, setTx] = useState<TxState>({ phase: "idle" });
  const [underwritingTxHash, setUnderwritingTxHash] = useState<`0x${string}` | undefined>(undefined);
  const [underwritingEventIndex, setUnderwritingEventIndex] = useState<number | null>(null);
  const [latestOnchainRequest, setLatestOnchainRequest] = useState<{
    txHash: `0x${string}`;
    blockNumber: bigint;
    intendedBorrowAmount: bigint;
  } | null>(null);

  const assetId = useMemo(() => toBigInt(assetIdInput), [assetIdInput]);
  const contracts = CONTRACTS[SUPPORTED_CHAIN_ID];

  const { isLoading: isConfirming, isSuccess: isConfirmed, error: receiptError } = useWaitForTransactionReceipt({
    hash: tx.hash,
    chainId: SUPPORTED_CHAIN_ID,
  });
  const underwritingReceipt = useWaitForTransactionReceipt({
    hash: underwritingTxHash,
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
      refetchInterval: 10000,
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
      refetchInterval: 10000,
    },
  });

  const navRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.navOracle,
    abi: NAV_ORACLE_ABI,
    functionName: "getNAVData",
    args: assetId !== null ? [assetId] : undefined,
    query: {
      enabled: Boolean(assetId !== null && currentChainId === SUPPORTED_CHAIN_ID),
      refetchInterval: 10000,
    },
  });

  const refetchPendingAmount = pendingAmountRead.refetch;
  const refetchTerms = termsRead.refetch;
  const refetchNav = navRead.refetch;

  useEffect(() => {
    if (tx.phase === "submitted" && isConfirming) {
      setTx((prev) => ({ ...prev, phase: "confirming", message: "Waiting for block confirmation..." }));
    }
  }, [isConfirming, tx.phase]);

  useEffect(() => {
    if (isConfirmed && tx.hash && tx.phase !== "confirmed") {
      setTx({
        phase: "confirmed",
        hash: tx.hash,
        message: "Transaction confirmed on Sepolia.",
      });
      void refetchPendingAmount();
      void refetchTerms();
      void refetchNav();
    }
  }, [isConfirmed, tx.hash, tx.phase, refetchPendingAmount, refetchTerms, refetchNav]);

  useEffect(() => {
    if (receiptError) {
      setTx((prev) => ({
        ...prev,
        phase: "failed",
        message: normalizeTxError(receiptError),
      }));
    }
  }, [receiptError]);

  useEffect(() => {
    if (!underwritingTxHash || !underwritingReceipt.data) return;

    const eventTopic = keccak256(toHex("UnderwritingRequested(address,uint256,uint256,uint64)"));
    const targetAddress = contracts.underwritingRegistry.toLowerCase();

    const targetLogPosition = underwritingReceipt.data.logs.findIndex((log) => {
      const logAddress = log.address.toLowerCase();
      const logTopic0 = (log.topics[0] ?? "").toLowerCase();
      return logAddress === targetAddress && logTopic0 === eventTopic.toLowerCase();
    });

    if (targetLogPosition < 0) {
      setUnderwritingEventIndex(null);
      return;
    }
    // CRE simulate expects event index relative to this tx's logs array (0-based).
    setUnderwritingEventIndex(targetLogPosition);
  }, [contracts.underwritingRegistry, underwritingReceipt.data, underwritingTxHash]);

  const terms = termsRead.data as TermsTuple | undefined;
  const pendingBorrowAmount = (pendingAmountRead.data as bigint | undefined) ?? 0n;
  const statusLoading = pendingAmountRead.isLoading || termsRead.isLoading;
  const statusError = pendingAmountRead.isError || termsRead.isError;
  const statusErrorMessage = pendingAmountRead.error?.message ?? termsRead.error?.message;

  useEffect(() => {
    if (!publicClient || !address || assetId === null || currentChainId !== SUPPORTED_CHAIN_ID) return;

    let isCancelled = false;

    const refreshLatestRequest = async () => {
      try {
        const latestBlock = await publicClient.getBlockNumber();
        const windows = [1_000n, 10_000n, 50_000n] as const;
        let logs: Awaited<ReturnType<typeof publicClient.getLogs<typeof UNDERWRITING_REQUESTED_EVENT>>> = [];

        for (const windowSize of windows) {
          const fromBlock = latestBlock > windowSize ? latestBlock - windowSize : 0n;
          try {
            const candidateLogs = await publicClient.getLogs({
              address: contracts.underwritingRegistry,
              event: UNDERWRITING_REQUESTED_EVENT,
              fromBlock,
              toBlock: "latest",
            });
            logs = candidateLogs.filter((log) => {
              return (
                (log.args.borrower?.toLowerCase() ?? "") === address.toLowerCase() &&
                (log.args.assetId ?? -1n) === assetId
              );
            });
            if (logs.length > 0) break;
          } catch {
            // Try next window size.
          }
        }

        if (isCancelled) return;
        if (logs.length === 0) {
          setLatestOnchainRequest(null);
          return;
        }

        const latest = logs[logs.length - 1];
        const txHash = latest.transactionHash as `0x${string}` | undefined;
        const blockNumber = latest.blockNumber;
        const intendedBorrowAmount = latest.args.intendedBorrowAmount as bigint | undefined;

        if (!txHash || blockNumber === undefined || intendedBorrowAmount === undefined) {
          setLatestOnchainRequest(null);
          return;
        }

        setLatestOnchainRequest({
          txHash,
          blockNumber,
          intendedBorrowAmount,
        });
      } catch {
        if (!isCancelled) setLatestOnchainRequest(null);
      }
    };

    void refreshLatestRequest();
    
    // Poll every 10 seconds to keep the simulation card up-to-date
    const interval = setInterval(() => {
        void refreshLatestRequest();
    }, 10000);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [address, assetId, contracts.underwritingRegistry, currentChainId, publicClient]);

  useEffect(() => {
    if (pendingBorrowAmount === 0n) return;
    if (!latestOnchainRequest?.txHash) return;
    if (underwritingTxHash === latestOnchainRequest.txHash) return;

    // Auto-select latest request tx for CRE simulate helper to avoid stale hash usage.
    setUnderwritingTxHash(latestOnchainRequest.txHash);
    setUnderwritingEventIndex(null);
  }, [latestOnchainRequest, pendingBorrowAmount, underwritingTxHash]);

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

      <section className="grid gap-6">
        <AssetSelector 
          selectedAssetId={assetIdInput}
          onSelect={setAssetIdInput}
        />

        <div className="grid gap-4 md:grid-cols-2">
                    <UnderwritingStatusCard
                      assetIdInput={assetIdInput}
                      pendingBorrowAmount={pendingBorrowAmount}
                      terms={terms}
                      nav={navRead.data ? (navRead.data as [bigint, bigint, `0x${string}`])[0] : 0n}
                      registryAddress={contracts.underwritingRegistry}
                      isLoading={statusLoading}
                      isError={statusError}
                      errorMessage={statusErrorMessage}
                    />            <article className="rounded-2xl border bg-[color:var(--card)] p-5">
            <p className="mono text-xs text-[color:var(--ink-700)]">CONFIDENTIALITY GUARANTEE</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <span className="rounded-lg bg-[color:var(--mint-100)] px-3 py-2">Income data: offchain</span>
                <span className="rounded-lg bg-[color:var(--mint-100)] px-3 py-2">Credit data: offchain</span>
                <span className="rounded-lg bg-[color:var(--mint-100)] px-3 py-2">KYC/AML: offchain</span>
                <span className="rounded-lg bg-[color:var(--mint-100)] px-3 py-2">AI reasoning: hashed</span>
            </div>
            </article>
        </div>
      </section>

      <NetworkGuard>
        <div className="grid gap-6">
          {assetIdInput && (
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
                    onUnderwritingRequestSubmitted={(hash) => {
                        setUnderwritingTxHash(hash);
                        setUnderwritingEventIndex(null);
                    }}
                />

                <CreSimulationCard
                    txHash={underwritingTxHash}
                    eventIndex={underwritingEventIndex}
                    latestOnchainTxHash={latestOnchainRequest?.txHash}
                    latestOnchainBlock={latestOnchainRequest?.blockNumber}
                    latestOnchainAmount={latestOnchainRequest?.intendedBorrowAmount}
                    pendingBorrowAmount={pendingBorrowAmount}
                />

                <BorrowForm
                    assetIdInput={assetIdInput}
                    terms={terms}
                    onTxStateChange={setTx}
                />
            </>
          )}
        </div>
      </NetworkGuard>

      <TxStatusInline tx={tx} chainId={SUPPORTED_CHAIN_ID} />
    </main>
  );
}
