"use client";

import { getExplorerTxUrl, type TxState } from "@/lib/tx";

type Props = {
  tx: TxState;
  chainId: number;
};

export default function TxStatusInline({ tx, chainId }: Props) {
  if (tx.phase === "idle") return null;

  return (
    <div className="rounded-xl border bg-[color:var(--card)] p-3 text-sm">
      <p className="mono text-xs text-[color:var(--ink-700)]">TRANSACTION</p>
      <p className="mt-1">
        Status: <span className="font-medium">{tx.phase.replaceAll("_", " ")}</span>
      </p>
      {tx.message && <p className="mt-1 text-xs text-[color:var(--ink-700)]">{tx.message}</p>}
      {tx.hash && (
        <a
          className="mono mt-2 inline-block text-xs underline"
          href={getExplorerTxUrl(chainId, tx.hash)}
          target="_blank"
          rel="noreferrer"
        >
          View on Etherscan
        </a>
      )}
    </div>
  );
}
