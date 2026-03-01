"use client";

import { useEffect, useMemo, useState } from "react";
import { keccak256, parseAbiItem, toHex, zeroAddress } from "viem";
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
import {
  CONTRACTS,
  NAV_ORACLE_ABI,
  UNDERWRITING_REGISTRY_ABI,
  UNDERWRITING_REGISTRY_V2_ABI,
} from "@/lib/contracts";
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
const UNDERWRITING_REQUESTED_EVENT_V2 = parseAbiItem(
  "event UnderwritingRequested(address indexed borrower, uint256 indexed assetId, uint256 intendedBorrowAmount, uint64 nonce, uint8 triggerType)",
);

import AssetSelector from "./AssetSelector";

export default function BorrowerDashboard() {
  const [mounted, setMounted] = useState(false);
  const { address } = useAccount();
  const currentChainId = useChainId();
  const publicClient = usePublicClient({ chainId: SUPPORTED_CHAIN_ID });

  useEffect(() => {
    setMounted(true);
  }, []);

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
  const borrowerArg = (address ?? zeroAddress) as `0x${string}`;
  const assetIdArg = assetId ?? 0n;
  const contracts = CONTRACTS[SUPPORTED_CHAIN_ID];
  const underwritingAddress = contracts.activeUnderwritingRegistry;
  const isV2 = contracts.usesUnderwritingV2;

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
    address: underwritingAddress,
    abi: isV2 ? UNDERWRITING_REGISTRY_V2_ABI : UNDERWRITING_REGISTRY_ABI,
    functionName: "getRequestedBorrowAmount",
    args: [borrowerArg, assetIdArg],
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
    args: [borrowerArg, assetIdArg],
    query: {
      enabled: Boolean(!isV2 && address && assetId !== null && currentChainId === SUPPORTED_CHAIN_ID),
      refetchInterval: 10000,
    },
  });

  const v2BorrowingTermsRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: underwritingAddress,
    abi: UNDERWRITING_REGISTRY_V2_ABI,
    functionName: "getBorrowingTerms",
    args: [borrowerArg, assetIdArg],
    query: {
      enabled: Boolean(isV2 && address && assetId !== null && currentChainId === SUPPORTED_CHAIN_ID),
      refetchInterval: 10000,
    },
  });

  const v2DecisionRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: underwritingAddress,
    abi: UNDERWRITING_REGISTRY_V2_ABI,
    functionName: "getDecision",
    args: [borrowerArg, assetIdArg],
    query: {
      enabled: Boolean(isV2 && address && assetId !== null && currentChainId === SUPPORTED_CHAIN_ID),
      refetchInterval: 10000,
    },
  });

  const v2ApprovedRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: underwritingAddress,
    abi: UNDERWRITING_REGISTRY_V2_ABI,
    functionName: "isApproved",
    args: [borrowerArg, assetIdArg],
    query: {
      enabled: Boolean(isV2 && address && assetId !== null && currentChainId === SUPPORTED_CHAIN_ID),
      refetchInterval: 10000,
    },
  });

  const navRead = useReadContract({
    chainId: SUPPORTED_CHAIN_ID,
    address: contracts.navOracle,
    abi: NAV_ORACLE_ABI,
    functionName: "getNAVData",
    args: [assetIdArg],
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

    const eventTopic = isV2
      ? keccak256(toHex("UnderwritingRequested(address,uint256,uint256,uint64,uint8)"))
      : keccak256(toHex("UnderwritingRequested(address,uint256,uint256,uint64)"));
    const targetAddress = underwritingAddress.toLowerCase();

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
  }, [underwritingAddress, underwritingReceipt.data, underwritingTxHash, isV2]);

  const terms = useMemo(() => {
    if (!isV2) {
      return termsRead.data as TermsTuple | undefined;
    }

    const borrowing = v2BorrowingTermsRead.data as [number, number, bigint, bigint] | undefined;
    const decision = v2DecisionRead.data as
      | {
          reasoningHash?: `0x${string}`;
          status?: number;
        }
      | undefined;
    const approved = (v2ApprovedRead.data as boolean | undefined) ?? false;
    if (!borrowing) return undefined;

    const [maxLtvBps, rateBps, creditLimit, expiry] = borrowing;
    const reasoningHash = (decision?.reasoningHash ??
      "0x0000000000000000000000000000000000000000000000000000000000000000") as `0x${string}`;

    return [approved, Number(maxLtvBps), Number(rateBps), creditLimit, expiry, reasoningHash] as TermsTuple;
  }, [isV2, termsRead.data, v2BorrowingTermsRead.data, v2DecisionRead.data, v2ApprovedRead.data]);
  const pendingBorrowAmount = (pendingAmountRead.data as bigint | undefined) ?? 0n;
  const statusLoading = pendingAmountRead.isLoading || termsRead.isLoading || v2BorrowingTermsRead.isLoading || v2DecisionRead.isLoading;
  const statusError = pendingAmountRead.isError || termsRead.isError || v2BorrowingTermsRead.isError || v2DecisionRead.isError || v2ApprovedRead.isError;
  const statusErrorMessage =
    pendingAmountRead.error?.message ??
    termsRead.error?.message ??
    v2BorrowingTermsRead.error?.message ??
    v2DecisionRead.error?.message ??
    v2ApprovedRead.error?.message;

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
              address: underwritingAddress,
              event: isV2 ? UNDERWRITING_REQUESTED_EVENT_V2 : UNDERWRITING_REQUESTED_EVENT,
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
  }, [address, assetId, underwritingAddress, currentChainId, publicClient, isV2]);

  useEffect(() => {
    if (pendingBorrowAmount === 0n) return;
    if (!latestOnchainRequest?.txHash) return;
    if (underwritingTxHash === latestOnchainRequest.txHash) return;

    // Auto-select latest request tx for CRE simulate helper to avoid stale hash usage.
    setUnderwritingTxHash(latestOnchainRequest.txHash);
    setUnderwritingEventIndex(null);
  }, [latestOnchainRequest, pendingBorrowAmount, underwritingTxHash]);

  if (!mounted) return null;

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

        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <UnderwritingStatusCard
              assetIdInput={assetIdInput}
              pendingBorrowAmount={pendingBorrowAmount}
              terms={terms}
              nav={navRead.data ? (navRead.data as [bigint, bigint, `0x${string}`])[0] : 0n}
              registryAddress={underwritingAddress}
              isLoading={statusLoading}
              isError={statusError}
              errorMessage={statusErrorMessage}
            />
          </div>
          <article className="rounded-2xl border bg-[color:var(--card)] p-5 flex flex-col h-full">
            <p className="mono text-xs text-[color:var(--ink-700)]">CONFIDENTIALITY GUARANTEE</p>
            <div className="mt-4 flex flex-col gap-3 text-sm flex-grow justify-center">
              <span className="rounded-lg bg-[color:var(--mint-100)] px-4 py-3 flex items-center gap-2 font-medium">
                <svg className="w-4 h-4 text-[color:var(--mint-500)]" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 2a1 1 0 00-1 1v1a1 1 0 002 0V3a1 1 0 00-1-1zM4 4h3a3 3 0 006 0h3a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zm2.5 7a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm2.45 4a2.5 2.5 0 10-4.9 0h4.9zM12 9a1 1 0 100 2h3a1 1 0 100-2h-3zm-1 4a1 1 0 011-1h2a1 1 0 110 2h-2a1 1 0 01-1-1z" clipRule="evenodd"></path></svg>
                Income data: offchain
              </span>
              <span className="rounded-lg bg-[color:var(--mint-100)] px-4 py-3 flex items-center gap-2 font-medium">
                <svg className="w-4 h-4 text-[color:var(--mint-500)]" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z"></path><path fillRule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clipRule="evenodd"></path></svg>
                Credit data: offchain
              </span>
              <span className="rounded-lg bg-[color:var(--mint-100)] px-4 py-3 flex items-center gap-2 font-medium">
                <svg className="w-4 h-4 text-[color:var(--mint-500)]" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"></path></svg>
                KYC/AML: offchain
              </span>
              <span className="rounded-lg bg-[color:var(--mint-100)] px-4 py-3 flex items-center gap-2 font-medium">
                <svg className="w-4 h-4 text-[color:var(--mint-500)]" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"></path></svg>
                AI reasoning: hashed
              </span>
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
                      v2BorrowingTermsRead.refetch();
                      v2DecisionRead.refetch();
                      v2ApprovedRead.refetch();
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
