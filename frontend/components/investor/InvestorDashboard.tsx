"use client";

import AssetOverview from "@/components/investor/AssetOverview";
import PoolOverview from "@/components/investor/PoolOverview";
import RecentUnderwritingOutcomes from "@/components/investor/RecentUnderwritingOutcomes";
import AppNav from "@/components/AppNav";
import WalletBar from "@/components/WalletBar";

export default function InvestorDashboard() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
      <AppNav />
      <WalletBar />

      <section className="rounded-3xl border bg-[color:var(--card)] p-6 shadow-[0_20px_60px_rgba(18,33,38,0.08)]">
        <p className="mono text-xs tracking-[0.24em] text-[color:var(--ink-700)]">
          CREDITWEAVE • INVESTOR VIEW
        </p>
        <h1 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">
          Portfolio visibility without borrower data exposure.
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-[color:var(--ink-700)] md:text-base">
          Investors see pool and asset-level onchain signals, plus recent underwriting outcomes. Private borrower
          financial data remains offchain.
        </p>
      </section>

      <PoolOverview />
      <AssetOverview />
      <RecentUnderwritingOutcomes />
    </main>
  );
}
