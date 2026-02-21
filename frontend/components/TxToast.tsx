"use client";

import { type TxState } from "@/lib/tx";

export default function TxToast({ tx }: { tx: TxState }) {
  if (tx.phase === "idle") return null;

  const isError = tx.phase === "failed";
  const bg = isError ? "bg-[#fdecea] text-[#8c2d25]" : "bg-[color:var(--ink-900)] text-white";

  return (
    <div className={`fixed bottom-4 right-4 z-50 rounded-xl px-4 py-3 text-sm shadow-lg ${bg}`}>
      <p className="font-medium">{tx.phase.replaceAll("_", " ")}</p>
      {tx.message && <p className="mt-1 text-xs opacity-90">{tx.message}</p>}
    </div>
  );
}
