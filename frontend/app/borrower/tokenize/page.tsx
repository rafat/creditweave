"use client";

import { useState } from "react";
import AppNav from "@/components/AppNav";
import WalletBar from "@/components/WalletBar";
import TxToast from "@/components/TxToast";
import NetworkGuard from "@/components/NetworkGuard";
import TokenizationWizard from "@/components/borrower/TokenizationWizard";
import TxStatusInline from "@/components/TxStatusInline";
import { type TxState } from "@/lib/tx";
import { SUPPORTED_CHAIN_ID } from "@/lib/wagmi";
import Link from "next/link";

export default function TokenizePage() {
  const [tx, setTx] = useState<TxState>({ phase: "idle" });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
      <AppNav />
      <WalletBar />
      <TxToast tx={tx} />

      <section className="rounded-3xl border bg-[color:var(--card)] p-6 shadow-[0_20px_60px_rgba(18,33,38,0.08)]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <p className="mono text-xs tracking-[0.24em] text-[color:var(--ink-700)] uppercase">
              CreditWeave • Asset Tokenization
            </p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">
              Bring your real estate onchain.
            </h1>
          </div>
          <Link 
            href="/borrower"
            className="inline-flex items-center gap-2 rounded-xl border bg-white px-5 py-2.5 text-sm font-medium transition hover:bg-gray-50"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Dashboard
          </Link>
        </div>
      </section>

      <NetworkGuard>
        <div className="max-w-4xl mx-auto w-full py-8">
          <TokenizationWizard
            onTokenized={() => {}}
            onTxStateChange={setTx}
          />
          
          <div className="mt-8 rounded-2xl border bg-blue-50 p-6">
            <h3 className="font-semibold text-blue-900 flex items-center gap-2">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              What happens next?
            </h3>
            <ul className="mt-4 space-y-3 text-sm text-blue-800">
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-200 text-xs font-bold">1</span>
                <span>The platform registers your property and deploys dedicated smart contracts for logic, revenue, and shares.</span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-200 text-xs font-bold">2</span>
                <span>Fractional share tokens (ERC20) equal to the property&apos;s market value are minted directly to your connected wallet.</span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-200 text-xs font-bold">3</span>
                <span>You can then return to the dashboard to deposit these shares as collateral and request a loan.</span>
              </li>
            </ul>
          </div>
        </div>
      </NetworkGuard>

      <TxStatusInline tx={tx} chainId={SUPPORTED_CHAIN_ID} />
    </main>
  );
}
