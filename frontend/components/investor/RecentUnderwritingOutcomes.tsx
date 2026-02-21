"use client";

import { useEffect, useState } from "react";
import { parseAbiItem } from "viem";
import { usePublicClient } from "wagmi";
import { CONTRACTS } from "@/lib/contracts";
import { SUPPORTED_CHAIN_ID } from "@/lib/wagmi";

type OutcomeRow = {
  txHash: string;
  borrower: string;
  assetId: string;
  approved: boolean;
  maxLtvBps: number;
  rateBps: number;
  blockNumber: bigint;
};

const EVENT = parseAbiItem(
  "event UnderwritingUpdated(address indexed borrower, uint256 indexed assetId, bool approved, uint16 maxLtvBps, uint16 rateBps, uint256 expiry, bytes32 reasoningHash)",
);

export default function RecentUnderwritingOutcomes() {
  const client = usePublicClient({ chainId: SUPPORTED_CHAIN_ID });
  const contracts = CONTRACTS[SUPPORTED_CHAIN_ID];
  const [rows, setRows] = useState<OutcomeRow[]>([]);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const loadLogs = async () => {
      if (!client) return;
      try {
        setError("");
        setIsLoading(true);
        const latest = await client.getBlockNumber();
        const fromBlock = latest > 5000n ? latest - 5000n : 0n;
        const logs = await client.getLogs({
          address: contracts.underwritingRegistry,
          event: EVENT,
          fromBlock,
          toBlock: "latest",
        });

        const parsed: OutcomeRow[] = logs
          .slice(-10)
          .reverse()
          .map((log) => ({
            txHash: log.transactionHash,
            borrower: String(log.args.borrower),
            assetId: String(log.args.assetId),
            approved: Boolean(log.args.approved),
            maxLtvBps: Number(log.args.maxLtvBps),
            rateBps: Number(log.args.rateBps),
            blockNumber: log.blockNumber ?? 0n,
          }));

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
  }, [client, contracts.underwritingRegistry]);

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
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="mono text-xs text-[color:var(--ink-700)]">
              <tr>
                <th className="py-2">Block</th>
                <th className="py-2">Borrower</th>
                <th className="py-2">Asset</th>
                <th className="py-2">Decision</th>
                <th className="py-2">Max LTV</th>
                <th className="py-2">Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.txHash}-${row.assetId}`} className="border-t">
                  <td className="py-2 mono">{row.blockNumber.toString()}</td>
                  <td className="py-2 mono">
                    {row.borrower.slice(0, 6)}...{row.borrower.slice(-4)}
                  </td>
                  <td className="py-2 mono">#{row.assetId}</td>
                  <td className="py-2">{row.approved ? "Approved" : "Denied"}</td>
                  <td className="py-2">{(row.maxLtvBps / 100).toFixed(2)}%</td>
                  <td className="py-2">{(row.rateBps / 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
