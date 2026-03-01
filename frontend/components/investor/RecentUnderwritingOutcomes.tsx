"use client";

import React, { useEffect, useState } from "react";
import { decodeEventLog, keccak256, parseAbi, parseAbiItem, toHex } from "viem";
import { usePublicClient } from "wagmi";
import { CONTRACTS } from "@/lib/contracts";
import { SUPPORTED_CHAIN_ID } from "@/lib/wagmi";

type AIExplanation = {
  summary: string;
  keyRisks: string[];
  confidenceLevel: string;
  riskFlags: string[];
};

type OutcomeRow = {
  txHash: string;
  borrower: string;
  assetId: string;
  approved: boolean;
  status: number;
  loanProduct: number;
  maxLtvBps: number;
  rateBps: number;
  creditLimit: bigint;
  expiry: bigint;
  nextReviewAt?: bigint;
  blockNumber: bigint;
  reasoningHash: `0x${string}`;
};

const EVENT_V1 = parseAbiItem(
  "event UnderwritingUpdated(address indexed borrower, uint256 indexed assetId, bool approved, uint16 maxLtvBps, uint16 rateBps, uint256 expiry, bytes32 reasoningHash)",
);
const EVENT_V2_ABI = parseAbi([
  "event UnderwritingUpdated(address indexed borrower, uint256 indexed assetId, uint64 nonce, uint8 loanProduct, uint8 status, uint16 maxLtvBps, uint16 rateBps, uint256 creditLimit, uint256 expiry, uint256 nextReviewAt, uint256 gracePeriodEnd, bytes32 reasoningHash, bytes32 policyVersion, bytes32 decisionId, bytes32 sourceHash, bytes32 covenantSetHash)",
]);

export default function RecentUnderwritingOutcomes() {
  const client = usePublicClient({ chainId: SUPPORTED_CHAIN_ID });
  const contracts = CONTRACTS[SUPPORTED_CHAIN_ID];
  const [rows, setRows] = useState<OutcomeRow[]>([]);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [explanationMap, setExplanationMap] = useState<Record<string, AIExplanation>>({});
  const [explanationLoading, setExplanationLoading] = useState<Record<string, boolean>>({});

  const statusLabel = (status: number): string => {
    if (status === 0) return "APPROVED";
    if (status === 1) return "CONDITIONAL";
    if (status === 2) return "WATCHLIST";
    if (status === 3) return "DENIED";
    return `UNKNOWN(${status})`;
  };

  const loanProductLabel = (loanProduct: number): string => {
    if (loanProduct === 1) return "BRIDGE";
    if (loanProduct === 2) return "STABILIZED_TERM";
    if (loanProduct === 3) return "CONSTRUCTION_LITE";
    return "UNSPECIFIED";
  };

  useEffect(() => {
    const loadLogs = async () => {
      if (!client) return;
      try {
        setError("");
        setIsLoading(true);
        const latest = await client.getBlockNumber();
        const fromBlock = latest > 5000n ? latest - 5000n : 0n;
        const logs = await client.getLogs({
          address: contracts.activeUnderwritingRegistry,
          fromBlock,
          toBlock: "latest",
        });

        const v1Topic = keccak256(
          toHex("UnderwritingUpdated(address,uint256,bool,uint16,uint16,uint256,bytes32)")
        ).toLowerCase();
        const v2Topic = keccak256(
          toHex("UnderwritingUpdated(address,uint256,uint64,uint8,uint8,uint16,uint16,uint256,uint256,uint256,uint256,bytes32,bytes32,bytes32,bytes32,bytes32)")
        ).toLowerCase();

        const parsed: OutcomeRow[] = logs
          .filter((log) => {
            const topic0 = (log.topics[0] ?? "").toLowerCase();
            return topic0 === v1Topic || topic0 === v2Topic;
          })
          .slice(-10)
          .reverse()
          .map((log) => {
            const topic0 = (log.topics[0] ?? "").toLowerCase();
            if (topic0 === v2Topic) {
              const decoded = decodeEventLog({
                abi: EVENT_V2_ABI,
                data: log.data,
                topics: log.topics,
                eventName: "UnderwritingUpdated",
              });
              const status = Number(decoded.args.status);
              return {
                txHash: log.transactionHash,
                borrower: String(decoded.args.borrower),
                assetId: String(decoded.args.assetId),
                approved: status === 0 || status === 1,
                status,
                loanProduct: Number(decoded.args.loanProduct),
                maxLtvBps: Number(decoded.args.maxLtvBps),
                rateBps: Number(decoded.args.rateBps),
                creditLimit: decoded.args.creditLimit,
                expiry: decoded.args.expiry,
                nextReviewAt: decoded.args.nextReviewAt,
                blockNumber: log.blockNumber ?? 0n,
                reasoningHash: decoded.args.reasoningHash as `0x${string}`,
              };
            }

            const decoded = decodeEventLog({
              abi: [EVENT_V1],
              data: log.data,
              topics: log.topics,
              eventName: "UnderwritingUpdated",
            });
            return {
              txHash: log.transactionHash,
              borrower: String(decoded.args.borrower),
              assetId: String(decoded.args.assetId),
              approved: Boolean(decoded.args.approved),
              status: Boolean(decoded.args.approved) ? 0 : 3,
              loanProduct: 0,
              maxLtvBps: Number(decoded.args.maxLtvBps),
              rateBps: Number(decoded.args.rateBps),
              creditLimit: 0n,
              expiry: decoded.args.expiry,
              blockNumber: log.blockNumber ?? 0n,
              reasoningHash: decoded.args.reasoningHash as `0x${string}`,
            };
          });

        setRows(parsed);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsLoading(false);
      }
    };

    loadLogs();
    const id = setInterval(loadLogs, 20_000);
    return () => clearInterval(id);
  }, [client, contracts.activeUnderwritingRegistry]);

  const fetchExplanation = async (hash: string) => {
    if (explanationMap[hash] || explanationLoading[hash]) return;
    
    setExplanationLoading(prev => ({ ...prev, [hash]: true }));
    try {
      const privateApiUrl = process.env.NEXT_PUBLIC_PRIVATE_API_URL ?? "http://localhost:3001";
      const res = await fetch(`${privateApiUrl}/frontend/explanations/${hash}`);
      if (!res.ok) throw new Error("Failed to fetch explanation");
      const data = await res.json();
      setExplanationMap(prev => ({ ...prev, [hash]: data.explanation }));
    } catch (err) {
      console.error("Error fetching AI reasoning:", err);
    } finally {
      setExplanationLoading(prev => ({ ...prev, [hash]: false }));
    }
  };

  const toggleRow = (hash: string) => {
    if (expandedHash === hash) {
      setExpandedHash(null);
    } else {
      setExpandedHash(hash);
      fetchExplanation(hash);
    }
  };

  return (
    <section className="rounded-2xl border bg-[color:var(--card)] p-5">
      <p className="mono text-xs text-[color:var(--ink-700)]">RECENT UNDERWRITING OUTCOMES</p>
      {error ? (
        <p className="mt-3 rounded-lg bg-[#fdecea] px-3 py-2 text-xs text-[#8c2d25]">{error}</p>
      ) : null}

      {isLoading ? (
        <p className="mt-3 text-sm text-[color:var(--ink-700)]">Loading underwriting outcomes...</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-[color:var(--ink-700)]">No recent outcomes found.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm border-collapse">
            <thead className="mono text-xs text-[color:var(--ink-700)]">
              <tr>
                <th className="py-3 px-2">Block</th>
                <th className="py-3 px-2">Borrower</th>
                <th className="py-3 px-2">Asset</th>
                <th className="py-3 px-2">Product</th>
                <th className="py-3 px-2">Decision</th>
                <th className="py-3 px-2">Max LTV</th>
                <th className="py-3 px-2">Rate</th>
                <th className="py-3 px-2">Credit Limit</th>
                <th className="py-3 px-2">Reasoning</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <React.Fragment key={`${row.txHash}-${row.assetId}`}>
                  <tr className={`border-t hover:bg-gray-50 transition-colors cursor-pointer ${expandedHash === row.reasoningHash ? 'bg-gray-50' : ''}`}
                      onClick={() => toggleRow(row.reasoningHash)}>
                    <td className="py-3 px-2 mono">{row.blockNumber.toString()}</td>
                    <td className="py-3 px-2 mono text-xs">
                      {row.borrower.slice(0, 6)}...{row.borrower.slice(-4)}
                    </td>
                    <td className="py-3 px-2 mono">#{row.assetId}</td>
                    <td className="py-3 px-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                        {loanProductLabel(row.loanProduct)}
                      </span>
                    </td>
                    <td className="py-3 px-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        row.status === 0 ? "bg-green-100 text-green-700" :
                        row.status === 1 ? "bg-blue-100 text-blue-700" :
                        row.status === 2 ? "bg-amber-100 text-amber-700" :
                        "bg-red-100 text-red-700"
                      }`}>
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td className="py-3 px-2">{(row.maxLtvBps / 100).toFixed(2)}%</td>
                    <td className="py-3 px-2">{(row.rateBps / 100).toFixed(2)}%</td>
                    <td className="py-3 px-2">${Number(row.creditLimit / 10n ** 18n).toLocaleString()}</td>
                    <td className="py-3 px-2">
                       <button className="text-blue-600 hover:underline text-xs font-semibold">
                         {expandedHash === row.reasoningHash ? "Hide AI Report" : "View AI Report"}
                       </button>
                    </td>
                  </tr>
                  {expandedHash === row.reasoningHash && (
                    <tr>
                      <td colSpan={9} className="px-4 py-4 bg-gray-50 border-t border-b">
                         <div className="rounded-xl border bg-white p-4 shadow-sm animate-in slide-in-from-top-2 duration-200">
                           <div className="flex items-center justify-between mb-3">
                             <p className="mono text-[10px] font-bold text-blue-600 uppercase tracking-wider">Confidential AI Credit Report</p>
                             <span className="mono text-[10px] text-gray-400">Hash: {row.reasoningHash.slice(0, 16)}...</span>
                           </div>
                           
                           {explanationLoading[row.reasoningHash] ? (
                             <div className="space-y-2 animate-pulse">
                               <div className="h-4 bg-gray-100 rounded w-3/4"></div>
                               <div className="h-4 bg-gray-100 rounded w-1/2"></div>
                             </div>
                           ) : explanationMap[row.reasoningHash] ? (
                             <div className="space-y-4">
                               <div>
                                 <p className="text-sm font-semibold text-gray-900 mb-1">Executive Summary</p>
                                 <p className="text-sm text-gray-600 leading-relaxed italic">
                                   &ldquo;{explanationMap[row.reasoningHash].summary}&rdquo;
                                 </p>
                               </div>
                               
                               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div>
                                    <p className="text-xs font-bold text-gray-500 uppercase mb-2">Key Risk Factors</p>
                                    <ul className="space-y-1">
                                      {explanationMap[row.reasoningHash].keyRisks.map((risk, i) => (
                                        <li key={i} className="text-xs text-gray-600 flex items-start gap-2">
                                          <span className="text-red-400 mt-0.5">•</span> {risk}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                  <div>
                                    <p className="text-xs font-bold text-gray-500 uppercase mb-2">Onchain Terms</p>
                                    <div className="mb-3 grid grid-cols-2 gap-2 text-[11px] text-gray-600">
                                      <span>Expiry</span>
                                      <span className="mono text-right">
                                        {row.expiry > 0n
                                          ? new Date(Number(row.expiry) * 1000).toISOString().slice(0, 10)
                                          : "N/A"}
                                      </span>
                                      <span>Next Review</span>
                                      <span className="mono text-right">
                                        {row.nextReviewAt && row.nextReviewAt > 0n
                                          ? new Date(Number(row.nextReviewAt) * 1000).toISOString().slice(0, 10)
                                          : "N/A"}
                                      </span>
                                    </div>
                                    <p className="text-xs font-bold text-gray-500 uppercase mb-2">AI Confidence & Flags</p>
                                    <div className="flex flex-wrap gap-2">
                                      <span className="rounded bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700 border border-blue-100">
                                        CONFIDENCE: {explanationMap[row.reasoningHash].confidenceLevel}
                                      </span>
                                      {explanationMap[row.reasoningHash].riskFlags.map((flag, i) => (
                                        <span key={i} className="rounded bg-gray-100 px-2 py-1 text-[10px] font-bold text-gray-600 border border-gray-200">
                                          {flag}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                               </div>
                             </div>
                           ) : (
                             <p className="text-sm text-red-500">Could not retrieve private reasoning. It may still be syncing.</p>
                           )}
                         </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
