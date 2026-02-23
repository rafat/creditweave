"use client";

import { useMemo, useState } from "react";

type Props = {
  txHash?: `0x${string}`;
  eventIndex?: number | null;
  latestOnchainTxHash?: `0x${string}`;
  latestOnchainBlock?: bigint;
  latestOnchainAmount?: bigint;
  pendingBorrowAmount?: bigint;
};

export default function CreSimulationCard({
  txHash,
  eventIndex,
  latestOnchainTxHash,
  latestOnchainBlock,
  latestOnchainAmount,
  pendingBorrowAmount,
}: Props) {
  const [copied, setCopied] = useState<"none" | "hash" | "command">("none");

  const command = useMemo(() => {
    if (!txHash || eventIndex === null || eventIndex === undefined) return "";
    return [
      "cd cre",
      "cre workflow simulate ./my-workflow \\",
      "  -T staging-settings \\",
      "  --non-interactive \\",
      "  --trigger-index 0 \\",
      `  --evm-tx-hash ${txHash} \\`,
      `  --evm-event-index ${eventIndex} \\`,
      "  --broadcast",
    ].join("\n");
  }, [eventIndex, txHash]);

  const copyText = async (value: string, kind: "hash" | "command") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setTimeout(() => setCopied("none"), 1800);
    } catch {
      setCopied("none");
    }
  };

  return (
    <section className="rounded-2xl border bg-[color:var(--card)] p-5">
      <p className="mono text-xs text-[color:var(--ink-700)]">CRE SIMULATION INPUT</p>
      {!txHash ? (
        <p className="mt-2 text-sm text-[color:var(--ink-700)]">
          Submit an underwriting request to get tx hash and event index for CRE simulation.
        </p>
      ) : (
        <div className="mt-3 space-y-3 text-sm">
          {latestOnchainTxHash && (
            <>
              <p className="flex justify-between gap-4">
                <span>Latest onchain request tx</span>
                <span className="mono break-all">{latestOnchainTxHash}</span>
              </p>
              <p className="flex justify-between gap-4">
                <span>Latest onchain request block</span>
                <span className="mono">
                  {latestOnchainBlock ? latestOnchainBlock.toString() : "N/A"}
                </span>
              </p>
              <p className="flex justify-between gap-4">
                <span>Latest event amount</span>
                <span className="mono">
                  {latestOnchainAmount ? latestOnchainAmount.toString() : "N/A"} wei
                </span>
              </p>
              {pendingBorrowAmount !== undefined &&
                latestOnchainAmount !== undefined &&
                pendingBorrowAmount !== latestOnchainAmount && (
                  <p className="rounded-lg bg-[#fff6ef] px-3 py-2 text-xs text-[#8c2d25]">
                    Latest event amount does not match current pending request. Use the most recent request tx.
                  </p>
                )}
            </>
          )}
          <p className="flex justify-between gap-4">
            <span>Underwriting request tx</span>
            <span className="mono break-all">{txHash}</span>
          </p>
          <p className="flex justify-between gap-4">
            <span>Underwriting event index</span>
            <span className="mono">
              {eventIndex === null || eventIndex === undefined ? "Detecting..." : eventIndex}
            </span>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => copyText(txHash, "hash")}
              className="rounded-lg border bg-white px-3 py-1.5 text-xs transition hover:bg-[color:var(--mint-100)]"
            >
              {copied === "hash" ? "Copied tx hash" : "Copy tx hash"}
            </button>
            <button
              type="button"
              disabled={!command}
              onClick={() => copyText(command, "command")}
              className="rounded-lg border bg-white px-3 py-1.5 text-xs transition hover:bg-[color:var(--mint-100)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {copied === "command" ? "Copied command" : "Copy CRE command"}
            </button>
          </div>
          <pre className="overflow-x-auto rounded-lg border bg-white p-3 text-xs">
            <code>
              {command || "Waiting for transaction receipt to detect event index..."}
            </code>
          </pre>
        </div>
      )}
    </section>
  );
}
